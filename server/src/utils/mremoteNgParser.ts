import { XMLParser } from 'fast-xml-parser';

export interface MremotengConnection {
  name: string;
  hostname: string;
  port: string;
  protocol: string;
  username?: string;
  password?: string;
  description?: string;
  panel?: string;
}

interface MremotengXmlRoot {
  Connections?: {
    Connection?: MremotengXmlNode | MremotengXmlNode[];
  };
}

interface MremotengXmlNode {
  Name?: string;
  Hostname?: string;
  Host?: string;
  Port?: string;
  Protocol?: string;
  Username?: string;
  Password?: string;
  Description?: string;
  Panel?: string;
  // Nested connections
  Connection?: MremotengXmlNode | MremotengXmlNode[];
}

export function parseMremotengXml(xml: string): MremotengConnection[] {
  const connections: MremotengConnection[] = [];

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: true,
  });

  try {
    const result = parser.parse(xml) as unknown as MremotengXmlRoot;

    if (!result.Connections?.Connection) {
      return connections;
    }

    const connectionNodes = Array.isArray(result.Connections.Connection)
      ? result.Connections.Connection
      : [result.Connections.Connection];

    for (const node of connectionNodes) {
      parseConnectionNode(node, connections);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to parse mRemoteNG XML: ${errorMessage}`);
  }

  return connections;
}

function parseConnectionNode(node: MremotengXmlNode, connections: MremotengConnection[]): void {
  if (node.Protocol) {
    const protocol = node.Protocol;
    const port = node.Port || getDefaultPort(protocol);

    connections.push({
      name: node.Name || 'Unnamed',
      hostname: node.Hostname || node.Host || '',
      port,
      protocol,
      username: node.Username,
      password: node.Password,
      description: node.Description,
      panel: node.Panel,
    });
  }

  if (node.Connection) {
    const childNodes = Array.isArray(node.Connection) ? node.Connection : [node.Connection];
    for (const child of childNodes) {
      parseConnectionNode(child, connections);
    }
  }
}

function getDefaultPort(protocol: string): string {
  const proto = protocol.toUpperCase();
  switch (proto) {
    case 'RDP':
      return '3389';
    case 'SSH':
    case 'TELNET':
    case 'SFTP':
    case 'SCP':
      return '22';
    case 'VNC':
      return '5900';
    case 'HTTP':
      return '80';
    case 'HTTPS':
      return '443';
    default:
      return '22';
  }
}

export function mapMremotengProtocol(protocol: string): 'RDP' | 'SSH' | 'VNC' | null {
  const proto = protocol.toUpperCase();
  switch (proto) {
    case 'RDP':
    case 'RDP2':
      return 'RDP';
    case 'SSH':
    case 'TELNET':
    case 'SFTP':
    case 'SCP':
    case 'RAWS':
      return 'SSH';
    case 'VNC':
      return 'VNC';
    default:
      return null;
  }
}
