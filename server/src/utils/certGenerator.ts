/**
 * X.509 Certificate Generator — ED25519-based PKI utility.
 *
 * Produces valid X.509 v3 certificates by constructing DER-encoded
 * TBSCertificate structures and signing them with ED25519.
 *
 * Used for auto-generating tunnel mTLS CA and client certificates.
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// ASN.1 DER helpers
// ---------------------------------------------------------------------------

/** DER tag constants */
const DER = {
  SEQUENCE:    0x30,
  SET:         0x31,
  INTEGER:     0x02,
  BIT_STRING:  0x03,
  OCTET_STRING: 0x04,
  NULL:        0x05,
  OID:         0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  UTC_TIME:    0x17,
  GENERALIZED_TIME: 0x18,
  CONTEXT_0:   0xa0,
  CONTEXT_3:   0xa3,
  BOOLEAN:     0x01,
} as const;

/** Encode a DER length field (short or long form). */
function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  if (len < 0x10000) return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  // 3-byte length
  return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

/** Wrap content in a DER TLV (tag-length-value). */
function derWrap(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function encodePemBlock(type: string, derBytes: Buffer): string {
  const b64 = derBytes.toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----\n`;
}

/** Encode a non-negative integer in DER (minimal, unsigned). */
function derInteger(value: Buffer | number): Buffer {
  let buf: Buffer;
  if (typeof value === 'number') {
    if (value === 0) {
      buf = Buffer.from([0]);
    } else {
      const hex = value.toString(16);
      const padded = hex.length % 2 ? '0' + hex : hex;
      buf = Buffer.from(padded, 'hex');
      // Add leading 0 if high bit set (unsigned)
      if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
    }
  } else {
    buf = value;
    // Ensure minimal unsigned encoding
    if (buf.length > 0 && (buf[0] & 0x80)) {
      buf = Buffer.concat([Buffer.from([0]), buf]);
    }
  }
  return derWrap(DER.INTEGER, buf);
}

/** Encode an OID from dotted-decimal string. */
function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [];
  // First two components are encoded as 40*X + Y
  bytes.push(40 * parts[0] + parts[1]);
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    if (v < 128) {
      bytes.push(v);
    } else {
      const stack: number[] = [];
      stack.push(v & 0x7f);
      v >>= 7;
      while (v > 0) {
        stack.push(0x80 | (v & 0x7f));
        v >>= 7;
      }
      stack.reverse();
      bytes.push(...stack);
    }
  }
  return derWrap(DER.OID, Buffer.from(bytes));
}

/** Encode a UTF8String. */
function derUtf8String(s: string): Buffer {
  return derWrap(DER.UTF8_STRING, Buffer.from(s, 'utf8'));
}

/** Encode a PrintableString. */
function derPrintableString(s: string): Buffer {
  return derWrap(DER.PRINTABLE_STRING, Buffer.from(s, 'ascii'));
}

/** Encode a date as UTCTime (for dates before 2050) or GeneralizedTime. */
function derTime(date: Date): Buffer {
  const year = date.getUTCFullYear();
  if (year < 2050) {
    const yy = String(year % 100).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mi = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return derWrap(DER.UTC_TIME, Buffer.from(`${yy}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
  }
  const yyyy = String(year).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return derWrap(DER.GENERALIZED_TIME, Buffer.from(`${yyyy}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
}

// Well-known OIDs
const OID_ED25519 = '1.3.101.112';
const OID_COMMON_NAME = '2.5.4.3';
const OID_ORGANIZATION = '2.5.4.10';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_SUBJECT_KEY_IDENTIFIER = '2.5.29.14';
const OID_AUTHORITY_KEY_IDENTIFIER = '2.5.29.35';
const OID_EXTENDED_KEY_USAGE = '2.5.29.37';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const OID_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';

// ED25519 AlgorithmIdentifier (no parameters — per RFC 8410)
const ED25519_ALGORITHM_ID = derWrap(DER.SEQUENCE, derOid(OID_ED25519));

// ---------------------------------------------------------------------------
// Certificate structures
// ---------------------------------------------------------------------------

/** Build an X.501 Name (RDNSequence) with CN and optional O. */
function buildName(cn: string, org?: string): Buffer {
  const cnAttr = derWrap(DER.SET, derWrap(DER.SEQUENCE,
    Buffer.concat([derOid(OID_COMMON_NAME), derUtf8String(cn)])));
  if (!org) return derWrap(DER.SEQUENCE, cnAttr);
  const orgAttr = derWrap(DER.SET, derWrap(DER.SEQUENCE,
    Buffer.concat([derOid(OID_ORGANIZATION), derPrintableString(org)])));
  return derWrap(DER.SEQUENCE, Buffer.concat([cnAttr, orgAttr]));
}

/** Build a Validity structure (notBefore, notAfter). */
function buildValidity(notBefore: Date, notAfter: Date): Buffer {
  return derWrap(DER.SEQUENCE, Buffer.concat([derTime(notBefore), derTime(notAfter)]));
}

/** Build SubjectPublicKeyInfo for an ED25519 public key (raw 32 bytes). */
function buildSpki(rawPublicKey: Buffer): Buffer {
  // BIT STRING: 0 unused bits prefix + raw key bytes
  const bitString = derWrap(DER.BIT_STRING, Buffer.concat([Buffer.from([0x00]), rawPublicKey]));
  return derWrap(DER.SEQUENCE, Buffer.concat([ED25519_ALGORITHM_ID, bitString]));
}

function buildSubjectAltNameExtension(
  sans: { dns?: string[]; ips?: string[]; uris?: string[] },
): Buffer | null {
  const sanEntries: Buffer[] = [];
  for (const dns of sans.dns ?? []) {
    sanEntries.push(derWrap(0x82, Buffer.from(dns, 'ascii')));
  }
  for (const ip of sans.ips ?? []) {
    const ipBuf = ip.includes(':')
      ? Buffer.from(ip === '::1' ? '00000000000000000000000000000001' : ip.replace(/:/g, ''), 'hex')
      : Buffer.from(ip.split('.').map(Number));
    sanEntries.push(derWrap(0x87, ipBuf));
  }
  for (const uri of sans.uris ?? []) {
    sanEntries.push(derWrap(0x86, Buffer.from(uri, 'ascii')));
  }
  if (sanEntries.length === 0) return null;
  const sanValue = derWrap(DER.SEQUENCE, Buffer.concat(sanEntries));
  return derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_SUBJECT_ALT_NAME),
    derWrap(DER.OCTET_STRING, sanValue),
  ]));
}

/** Build extensions for a CA certificate. */
function buildCaExtensions(publicKeyRaw: Buffer): Buffer {
  // Basic Constraints: CA=TRUE, critical
  const bcValue = derWrap(DER.SEQUENCE, derWrap(DER.BOOLEAN, Buffer.from([0xff])));
  const bcExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_BASIC_CONSTRAINTS),
    derWrap(DER.BOOLEAN, Buffer.from([0xff])), // critical
    derWrap(DER.OCTET_STRING, bcValue),
  ]));

  // Key Usage: keyCertSign + cRLSign (bits 5 and 6), critical
  // Bit string: 0x06 = 00000110 (big-endian, with 1 unused bit at the end → padded)
  // Actually: keyCertSign=bit5, cRLSign=bit6 → byte value 0x06, padding 1 bit
  const kuBits = derWrap(DER.BIT_STRING, Buffer.from([0x01, 0x06]));
  const kuExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_KEY_USAGE),
    derWrap(DER.BOOLEAN, Buffer.from([0xff])), // critical
    derWrap(DER.OCTET_STRING, kuBits),
  ]));

  // Subject Key Identifier
  const keyHash = crypto.createHash('sha1').update(publicKeyRaw).digest();
  const skiExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_SUBJECT_KEY_IDENTIFIER),
    derWrap(DER.OCTET_STRING, derWrap(DER.OCTET_STRING, keyHash)),
  ]));

  return derWrap(DER.CONTEXT_3, derWrap(DER.SEQUENCE, Buffer.concat([bcExt, kuExt, skiExt])));
}

/** Build extensions for a client (end-entity) certificate. */
function buildClientExtensions(clientKeyRaw: Buffer, caKeyRaw: Buffer, spiffeId: string): Buffer {
  // Basic Constraints: CA=FALSE (not critical, default)
  const bcValue = derWrap(DER.SEQUENCE, Buffer.alloc(0));
  const bcExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_BASIC_CONSTRAINTS),
    derWrap(DER.OCTET_STRING, bcValue),
  ]));

  // Key Usage: digitalSignature (bit 0), critical
  // digitalSignature = bit 0 = 0x80, with 7 unused bits
  const kuBits = derWrap(DER.BIT_STRING, Buffer.from([0x07, 0x80]));
  const kuExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_KEY_USAGE),
    derWrap(DER.BOOLEAN, Buffer.from([0xff])), // critical
    derWrap(DER.OCTET_STRING, kuBits),
  ]));

  // Extended Key Usage: clientAuth
  const ekuValue = derWrap(DER.SEQUENCE, derOid(OID_CLIENT_AUTH));
  const ekuExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_EXTENDED_KEY_USAGE),
    derWrap(DER.OCTET_STRING, ekuValue),
  ]));

  const sanExt = buildSubjectAltNameExtension({ uris: [spiffeId] });
  if (!sanExt) {
    throw new Error('client certificates require a SPIFFE URI SAN');
  }

  // Subject Key Identifier
  const subjectKeyHash = crypto.createHash('sha1').update(clientKeyRaw).digest();
  const skiExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_SUBJECT_KEY_IDENTIFIER),
    derWrap(DER.OCTET_STRING, derWrap(DER.OCTET_STRING, subjectKeyHash)),
  ]));

  // Authority Key Identifier
  const caKeyHash = crypto.createHash('sha1').update(caKeyRaw).digest();
  const akiValue = derWrap(DER.SEQUENCE,
    derWrap(0x80, caKeyHash), // implicit [0] keyIdentifier
  );
  const akiExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_AUTHORITY_KEY_IDENTIFIER),
    derWrap(DER.OCTET_STRING, akiValue),
  ]));

  return derWrap(
    DER.CONTEXT_3,
    derWrap(DER.SEQUENCE, Buffer.concat([bcExt, kuExt, ekuExt, sanExt, skiExt, akiExt])),
  );
}

/** Build extensions for a server (end-entity) certificate with SANs. */
function buildServerExtensions(
  serverKeyRaw: Buffer,
  caKeyRaw: Buffer,
  sans: { dns: string[]; ips: string[]; uris?: string[] },
): Buffer {
  // Basic Constraints: CA=FALSE
  const bcValue = derWrap(DER.SEQUENCE, Buffer.alloc(0));
  const bcExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_BASIC_CONSTRAINTS),
    derWrap(DER.OCTET_STRING, bcValue),
  ]));

  // Key Usage: digitalSignature + keyEncipherment (bits 0 and 2), critical
  // digitalSignature=bit0(0x80) + keyEncipherment=bit2(0x20) = 0xA0, 5 unused bits
  const kuBits = derWrap(DER.BIT_STRING, Buffer.from([0x05, 0xa0]));
  const kuExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_KEY_USAGE),
    derWrap(DER.BOOLEAN, Buffer.from([0xff])), // critical
    derWrap(DER.OCTET_STRING, kuBits),
  ]));

  // Extended Key Usage: serverAuth
  const ekuValue = derWrap(DER.SEQUENCE, derOid(OID_SERVER_AUTH));
  const ekuExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_EXTENDED_KEY_USAGE),
    derWrap(DER.OCTET_STRING, ekuValue),
  ]));

  const sanExt = buildSubjectAltNameExtension(sans);
  if (!sanExt) {
    throw new Error('server certificates require at least one SAN');
  }

  // Subject Key Identifier
  const subjectKeyHash = crypto.createHash('sha1').update(serverKeyRaw).digest();
  const skiExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_SUBJECT_KEY_IDENTIFIER),
    derWrap(DER.OCTET_STRING, derWrap(DER.OCTET_STRING, subjectKeyHash)),
  ]));

  // Authority Key Identifier
  const caKeyHash = crypto.createHash('sha1').update(caKeyRaw).digest();
  const akiValue = derWrap(DER.SEQUENCE,
    derWrap(0x80, caKeyHash),
  );
  const akiExt = derWrap(DER.SEQUENCE, Buffer.concat([
    derOid(OID_AUTHORITY_KEY_IDENTIFIER),
    derWrap(DER.OCTET_STRING, akiValue),
  ]));

  return derWrap(DER.CONTEXT_3, derWrap(DER.SEQUENCE,
    Buffer.concat([bcExt, kuExt, ekuExt, sanExt, skiExt, akiExt])));
}

/** Generate a random serial number (20 bytes, positive). */
function randomSerial(): Buffer {
  const raw = crypto.randomBytes(20);
  // Ensure positive (clear high bit)
  raw[0] &= 0x7f;
  // Ensure non-zero
  if (raw.every(b => b === 0)) raw[0] = 1;
  return raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CertKeyPair {
  /** PEM-encoded X.509 certificate */
  certPem: string;
  /** PEM-encoded private key (PKCS#8) */
  keyPem: string;
  /** Raw 32-byte ED25519 public key */
  publicKeyRaw: Buffer;
  /** Certificate expiry date */
  expiry: Date;
}

/**
 * Generate a self-signed ED25519 CA certificate.
 *
 * @param cn - Common Name for the CA (e.g. "arsenale-tenant-{id}")
 * @param validityDays - Certificate validity in days (default: 3650 = ~10 years)
 */
export function generateCaCert(cn: string, validityDays = 3650): CertKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const rawPublic = publicKey.export({ type: 'spki', format: 'der' });
  // ED25519 SPKI is: SEQUENCE { AlgId, BIT STRING { 0x00 || 32-byte key } }
  // The raw 32-byte key starts at offset 12 (after SPKI header)
  const publicKeyRaw = rawPublic.subarray(rawPublic.length - 32);

  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  const now = new Date();
  const expiry = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const name = buildName(cn, 'Arsenale');
  const version = derWrap(DER.CONTEXT_0, derInteger(2)); // v3
  const serial = derInteger(randomSerial());
  const validity = buildValidity(now, expiry);
  const spki = buildSpki(publicKeyRaw);
  const extensions = buildCaExtensions(publicKeyRaw);

  // TBSCertificate
  const tbsCert = derWrap(DER.SEQUENCE, Buffer.concat([
    version,
    serial,
    ED25519_ALGORITHM_ID, // signature algorithm
    name,                 // issuer (self-signed → same as subject)
    validity,
    name,                 // subject
    spki,
    extensions,
  ]));

  // Sign TBSCertificate with ED25519
  const signature = crypto.sign(null, tbsCert, privateKey);
  const signatureBits = derWrap(DER.BIT_STRING, Buffer.concat([Buffer.from([0x00]), signature]));

  // Full Certificate
  const cert = derWrap(DER.SEQUENCE, Buffer.concat([
    tbsCert,
    ED25519_ALGORITHM_ID, // signatureAlgorithm
    signatureBits,
  ]));

  const certPem = encodePemBlock('CERTIFICATE', cert);

  return { certPem, keyPem, publicKeyRaw, expiry };
}

/**
 * Generate an ED25519 client certificate signed by the given CA.
 *
 * @param caCertPem - PEM-encoded CA certificate (used for issuer name extraction and AKI)
 * @param caKeyPem - PEM-encoded CA private key (PKCS#8)
 * @param cn - Common Name for the client cert (e.g. the gatewayId)
 * @param spiffeId - SPIFFE URI SAN embedded in the certificate identity
 * @param validityDays - Certificate validity in days (default: 90)
 */
export function generateClientCertificate(
  caCertPem: string,
  caKeyPem: string,
  cn: string,
  spiffeId: string,
  validityDays = 90,
): CertKeyPair {
  const caPrivateKey = crypto.createPrivateKey(caKeyPem);
  const caCert = new crypto.X509Certificate(caCertPem);

  // Extract CA public key raw bytes for Authority Key Identifier
  const caSpkiDer = caCert.publicKey.export({ type: 'spki', format: 'der' });
  const caPublicKeyRaw = caSpkiDer.subarray(caSpkiDer.length - 32);

  // Extract issuer name DER from the CA certificate
  // We rebuild from the CA cert's subject (which is the issuer for signed certs)
  const caSubjectCn = extractCn(caCert.subject);
  const caSubjectOrg = extractOrg(caCert.subject);
  const issuerName = buildName(caSubjectCn, caSubjectOrg || undefined);

  // Generate client key pair
  const { publicKey: clientPublicKey, privateKey: clientPrivateKey } = crypto.generateKeyPairSync('ed25519');
  const clientSpki = clientPublicKey.export({ type: 'spki', format: 'der' });
  const clientPublicKeyRaw = clientSpki.subarray(clientSpki.length - 32);
  const clientKeyPem = clientPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  const now = new Date();
  const expiry = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const subjectName = buildName(cn);
  const version = derWrap(DER.CONTEXT_0, derInteger(2)); // v3
  const serial = derInteger(randomSerial());
  const validity = buildValidity(now, expiry);
  const spki = buildSpki(clientPublicKeyRaw);
  const extensions = buildClientExtensions(clientPublicKeyRaw, caPublicKeyRaw, spiffeId);

  // TBSCertificate
  const tbsCert = derWrap(DER.SEQUENCE, Buffer.concat([
    version,
    serial,
    ED25519_ALGORITHM_ID, // signature algorithm
    issuerName,
    validity,
    subjectName,
    spki,
    extensions,
  ]));

  // Sign with CA private key
  const signature = crypto.sign(null, tbsCert, caPrivateKey);
  const signatureBits = derWrap(DER.BIT_STRING, Buffer.concat([Buffer.from([0x00]), signature]));

  // Full Certificate
  const cert = derWrap(DER.SEQUENCE, Buffer.concat([
    tbsCert,
    ED25519_ALGORITHM_ID,
    signatureBits,
  ]));

  const certPem = encodePemBlock('CERTIFICATE', cert);

  return { certPem, keyPem: clientKeyPem, publicKeyRaw: clientPublicKeyRaw, expiry };
}

/**
 * Generate a self-signed server certificate suitable for HTTPS.
 *
 * Creates a temporary CA and issues a server certificate with proper
 * serverAuth EKU and SANs for localhost development.
 *
 * @param cn - Common Name (default: "localhost")
 * @param validityDays - Certificate validity in days (default: 365)
 */
export function generateSelfSignedServerCert(
  cn = 'localhost',
  validityDays = 365,
): { cert: string; key: string; ca: string } {
  const ca = generateCaCert('arsenale-dev-ca', validityDays);
  const server = generateServerCertificate(
    ca.certPem,
    ca.keyPem,
    cn,
    { dns: ['localhost'], ips: ['127.0.0.1', '::1'] },
    validityDays,
  );
  return { cert: server.certPem, key: server.keyPem, ca: ca.certPem };
}

/**
 * Generate an ED25519 server certificate signed by the given CA.
 *
 * Includes serverAuth EKU and Subject Alternative Names (DNS + IP).
 *
 * @param caCertPem - PEM-encoded CA certificate
 * @param caKeyPem - PEM-encoded CA private key (PKCS#8)
 * @param cn - Common Name for the server cert
 * @param sans - Subject Alternative Names (DNS names and IP addresses)
 * @param validityDays - Certificate validity in days (default: 365)
 */
export function generateServerCertificate(
  caCertPem: string,
  caKeyPem: string,
  cn: string,
  sans: { dns: string[]; ips: string[]; uris?: string[] },
  validityDays = 365,
): CertKeyPair {
  const caPrivateKey = crypto.createPrivateKey(caKeyPem);
  const caCert = new crypto.X509Certificate(caCertPem);

  const caSpkiDer = caCert.publicKey.export({ type: 'spki', format: 'der' });
  const caPublicKeyRaw = caSpkiDer.subarray(caSpkiDer.length - 32);

  const caSubjectCn = extractCn(caCert.subject);
  const caSubjectOrg = extractOrg(caCert.subject);
  const issuerName = buildName(caSubjectCn, caSubjectOrg || undefined);

  const { publicKey: serverPublicKey, privateKey: serverPrivateKey } = crypto.generateKeyPairSync('ed25519');
  const serverSpki = serverPublicKey.export({ type: 'spki', format: 'der' });
  const serverPublicKeyRaw = serverSpki.subarray(serverSpki.length - 32);
  const serverKeyPem = serverPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  const now = new Date();
  const expiry = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const subjectName = buildName(cn);
  const version = derWrap(DER.CONTEXT_0, derInteger(2));
  const serial = derInteger(randomSerial());
  const validity = buildValidity(now, expiry);
  const spki = buildSpki(serverPublicKeyRaw);
  const extensions = buildServerExtensions(serverPublicKeyRaw, caPublicKeyRaw, sans);

  const tbsCert = derWrap(DER.SEQUENCE, Buffer.concat([
    version,
    serial,
    ED25519_ALGORITHM_ID,
    issuerName,
    validity,
    subjectName,
    spki,
    extensions,
  ]));

  const signature = crypto.sign(null, tbsCert, caPrivateKey);
  const signatureBits = derWrap(DER.BIT_STRING, Buffer.concat([Buffer.from([0x00]), signature]));

  const cert = derWrap(DER.SEQUENCE, Buffer.concat([
    tbsCert,
    ED25519_ALGORITHM_ID,
    signatureBits,
  ]));

  const certPem = encodePemBlock('CERTIFICATE', cert);

  return { certPem, keyPem: serverKeyPem, publicKeyRaw: serverPublicKeyRaw, expiry };
}

/**
 * Compute the SHA-256 fingerprint of a PEM-encoded certificate.
 * Returns a lowercase hex string.
 */
export function certFingerprint(certPem: string): string {
  const cert = new crypto.X509Certificate(certPem);
  // cert.fingerprint256 returns "XX:XX:..." — strip colons and lowercase
  return cert.fingerprint256.replace(/:/g, '').toLowerCase();
}

/**
 * Verify that a client certificate was signed by the given CA.
 */
export function verifyCertChain(clientCertPem: string, caCertPem: string): boolean {
  try {
    const clientCert = new crypto.X509Certificate(clientCertPem);
    const caCert = new crypto.X509Certificate(caCertPem);
    const now = Date.now();
    return clientCert.checkIssued(caCert) &&
      clientCert.verify(caCert.publicKey) &&
      Date.parse(clientCert.validFrom) <= now &&
      Date.parse(clientCert.validTo) >= now;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract CN from an X509Certificate.subject string (format: "CN=value\nO=value"). */
function extractCn(subject: string): string {
  const match = subject.match(/CN=([^\n]+)/);
  return match ? match[1].trim() : 'unknown';
}

/** Extract O from an X509Certificate.subject string. */
function extractOrg(subject: string): string | null {
  const match = subject.match(/O=([^\n]+)/);
  return match ? match[1].trim() : null;
}
