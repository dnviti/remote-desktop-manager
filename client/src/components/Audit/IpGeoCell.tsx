import { Box, Link, Tooltip, Typography } from '@mui/material';
import { Language as GlobeIcon } from '@mui/icons-material';

/**
 * Convert ISO 3166-1 alpha-2 country code to flag emoji.
 * Works by mapping each letter to a Regional Indicator Symbol.
 */
function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '';
  const chars = code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
  return chars.join('');
}

/**
 * Determine the country code from the country name.
 * We store the full country name in geoCountry but need the ISO code for the flag.
 * The geoCity field is used for display. For the flag, we fall back to showing
 * a globe icon if we can't determine the code.
 */
function getCountryCode(geoCountry: string | null): string | null {
  if (!geoCountry) return null;
  // Common country name to ISO 3166-1 alpha-2 mapping
  // MaxMind returns English names; we map the most common ones
  const map: Record<string, string> = {
    'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Andorra': 'AD',
    'Angola': 'AO', 'Argentina': 'AR', 'Armenia': 'AM', 'Australia': 'AU',
    'Austria': 'AT', 'Azerbaijan': 'AZ', 'Bahrain': 'BH', 'Bangladesh': 'BD',
    'Belarus': 'BY', 'Belgium': 'BE', 'Bolivia': 'BO', 'Bosnia and Herzegovina': 'BA',
    'Brazil': 'BR', 'Bulgaria': 'BG', 'Cambodia': 'KH', 'Cameroon': 'CM',
    'Canada': 'CA', 'Chile': 'CL', 'China': 'CN', 'Colombia': 'CO',
    'Costa Rica': 'CR', 'Croatia': 'HR', 'Cuba': 'CU', 'Cyprus': 'CY',
    'Czechia': 'CZ', 'Czech Republic': 'CZ', 'Denmark': 'DK',
    'Dominican Republic': 'DO', 'Ecuador': 'EC', 'Egypt': 'EG',
    'El Salvador': 'SV', 'Estonia': 'EE', 'Ethiopia': 'ET',
    'Finland': 'FI', 'France': 'FR', 'Georgia': 'GE', 'Germany': 'DE',
    'Ghana': 'GH', 'Greece': 'GR', 'Guatemala': 'GT', 'Honduras': 'HN',
    'Hong Kong': 'HK', 'Hungary': 'HU', 'Iceland': 'IS', 'India': 'IN',
    'Indonesia': 'ID', 'Iran': 'IR', 'Iraq': 'IQ', 'Ireland': 'IE',
    'Israel': 'IL', 'Italy': 'IT', 'Jamaica': 'JM', 'Japan': 'JP',
    'Jordan': 'JO', 'Kazakhstan': 'KZ', 'Kenya': 'KE', 'Kuwait': 'KW',
    'Kyrgyzstan': 'KG', 'Latvia': 'LV', 'Lebanon': 'LB', 'Libya': 'LY',
    'Lithuania': 'LT', 'Luxembourg': 'LU', 'Macao': 'MO', 'Malaysia': 'MY',
    'Malta': 'MT', 'Mexico': 'MX', 'Moldova': 'MD', 'Mongolia': 'MN',
    'Montenegro': 'ME', 'Morocco': 'MA', 'Mozambique': 'MZ', 'Myanmar': 'MM',
    'Nepal': 'NP', 'Netherlands': 'NL', 'New Zealand': 'NZ', 'Nicaragua': 'NI',
    'Nigeria': 'NG', 'North Korea': 'KP', 'North Macedonia': 'MK',
    'Norway': 'NO', 'Oman': 'OM', 'Pakistan': 'PK', 'Palestine': 'PS',
    'Panama': 'PA', 'Paraguay': 'PY', 'Peru': 'PE', 'Philippines': 'PH',
    'Poland': 'PL', 'Portugal': 'PT', 'Puerto Rico': 'PR', 'Qatar': 'QA',
    'Romania': 'RO', 'Russia': 'RU', 'Rwanda': 'RW', 'Saudi Arabia': 'SA',
    'Senegal': 'SN', 'Serbia': 'RS', 'Singapore': 'SG', 'Slovakia': 'SK',
    'Slovenia': 'SI', 'South Africa': 'ZA', 'South Korea': 'KR', 'Spain': 'ES',
    'Sri Lanka': 'LK', 'Sudan': 'SD', 'Sweden': 'SE', 'Switzerland': 'CH',
    'Syria': 'SY', 'Taiwan': 'TW', 'Tajikistan': 'TJ', 'Tanzania': 'TZ',
    'Thailand': 'TH', 'Tunisia': 'TN', 'Turkey': 'TR', 'Turkmenistan': 'TM',
    'Uganda': 'UG', 'Ukraine': 'UA', 'United Arab Emirates': 'AE',
    'United Kingdom': 'GB', 'United States': 'US', 'Uruguay': 'UY',
    'Uzbekistan': 'UZ', 'Venezuela': 'VE', 'Vietnam': 'VN', 'Yemen': 'YE',
    'Zambia': 'ZM', 'Zimbabwe': 'ZW',
  };
  return map[geoCountry] ?? null;
}

interface IpGeoCellProps {
  ipAddress: string | null;
  geoCountry: string | null;
  geoCity: string | null;
  onGeoIpClick?: (ip: string) => void;
}

/**
 * Renders an IP address cell with geolocation info and a clickable
 * action to inspect the IP in the GeoIpDialog.
 */
export default function IpGeoCell({ ipAddress, geoCountry, geoCity, onGeoIpClick }: IpGeoCellProps) {
  if (!ipAddress) return <>{'\u2014'}</>;

  const code = getCountryCode(geoCountry);
  const flag = countryFlag(code);
  const geoLabel = [geoCity, geoCountry].filter(Boolean).join(', ');

  // Extract the public IPv4 for display and GeoIP lookup.
  // The raw value might be a single IP or comma-separated (legacy entries).
  const publicIp = extractPublicIPv4(ipAddress);
  // Display the public IPv4 when available, otherwise show the raw value.
  const displayIp = publicIp ?? ipAddress;
  const isExternal = !!publicIp;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onGeoIpClick && publicIp) {
      onGeoIpClick(publicIp);
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {flag && (
        <Tooltip title={geoLabel || geoCountry || ''}>
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>{flag}</span>
        </Tooltip>
      )}
      {isExternal && onGeoIpClick ? (
        <Tooltip title={geoLabel ? `${geoLabel} \u2014 Click to inspect` : 'Click to inspect IP'}>
          <Link
            component="button"
            onClick={handleClick}
            sx={{
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' },
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.3,
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              font: 'inherit',
              color: 'primary.main',
              p: 0,
            }}
          >
            {displayIp}
            <GlobeIcon sx={{ fontSize: 14, opacity: 0.6 }} />
          </Link>
        </Tooltip>
      ) : isExternal ? (
        <Tooltip title={geoLabel ? `${geoLabel}` : displayIp}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {displayIp}
            <GlobeIcon sx={{ fontSize: 14, opacity: 0.4 }} />
          </span>
        </Tooltip>
      ) : (
        <span>{displayIp}</span>
      )}
      {geoLabel && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: 0.5, whiteSpace: 'nowrap' }}
        >
          {geoLabel}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Check if a single IP address is private/reserved (not externally routable).
 */
function isPrivateIp(ip: string): boolean {
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  // IPv4 private ranges
  if (clean.startsWith('10.') || clean.startsWith('192.168.') || clean === '127.0.0.1' || clean === '::1') {
    return true;
  }
  // 172.16.0.0 - 172.31.255.255
  if (clean.startsWith('172.')) {
    const second = parseInt(clean.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // localhost / IPv6 link-local
  if (clean === 'localhost' || clean.startsWith('fe80:') || clean.startsWith('fd') || clean.startsWith('fc')) return true;
  return false;
}

/**
 * Check if a string looks like a valid IPv4 address (not IPv6).
 */
function isIPv4(ip: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/**
 * From a raw IP string (which may contain multiple comma-separated IPs),
 * extract the first public IPv4 address suitable for GeoIP lookup.
 * Returns null if no public IPv4 is found.
 */
function extractPublicIPv4(raw: string): string | null {
  const parts = raw.split(',').map((s) => {
    const trimmed = s.trim();
    return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
  });
  return parts.find((p) => isIPv4(p) && !isPrivateIp(p)) ?? null;
}

/**
 * Export the flag helper for CSV export and map usage.
 */
// eslint-disable-next-line react-refresh/only-export-components
export { getCountryCode, countryFlag };
