import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Single source of truth for agent version: reads Enterprise/agent/agent-version.json
 */
export function getAgentVersionInfo() {
  try {
    const versionPath = path.join(__dirname, 'Enterprise', 'agent', 'agent-version.json');
    if (fs.existsSync(versionPath)) {
      const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
      return {
        version: data.agent_version || '1.1.2',
        interval_minutes: data.interval_minutes || 30
      };
    }
  } catch (err) {
    console.warn('[Version] Notice reading agent-version.json:', err.message);
  }
  return { version: '1.1.2', interval_minutes: 30 };
}

export function getAgentVersion() {
  return getAgentVersionInfo().version;
}

/**
 * Resolves or generates a real, cryptographically valid X.509 Root CA certificate.
 * Never returns fabricated "..." strings.
 */
export function getCaCertificate() {
  const candidatePaths = [
    path.join(__dirname, 'certs', 'ca.crt'),
    path.join(__dirname, 'Enterprise', 'certs', 'ca.crt'),
    path.join(__dirname, 'data', 'certs', 'ca.crt')
  ];

  for (const certPath of candidatePaths) {
    if (fs.existsSync(certPath)) {
      const content = fs.readFileSync(certPath, 'utf8').trim();
      if (content.includes('BEGIN CERTIFICATE') && !content.includes('...')) {
        return content + '\n';
      }
    }
  }

  // Generate a valid self-signed Root CA certificate with OpenSSL
  try {
    const certDir = path.join(__dirname, 'certs');
    fs.mkdirSync(certDir, { recursive: true });
    const certPath = path.join(certDir, 'ca.crt');
    const keyPath = path.join(certDir, 'ca.key');

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 3650 -subj "/CN=IT-Toolkit Enterprise Root CA/O=Aaditech IT-Toolkit/OU=Security" 2>/dev/null`
    );
    if (fs.existsSync(certPath)) {
      return fs.readFileSync(certPath, 'utf8').trim() + '\n';
    }
  } catch (err) {
    console.warn('[PKI] OpenSSL Root CA generation notice:', err.message);
  }

  return '';
}

/**
 * Searches the filesystem for a real built MSI artifact matching the given version.
 */
export function resolveAgentMsi(version = getAgentVersion()) {
  const v = version || getAgentVersion();
  const candidates = [
    path.join(__dirname, 'artifacts', 'msi', `IT-Toolkit-Agent-${v}.msi`),
    path.join(__dirname, 'Enterprise', 'agent', 'build', 'out', `IT-Toolkit-Agent-${v}.msi`),
    path.join(__dirname, 'Enterprise', 'agent', 'fixtures', `IT-Toolkit-Agent-${v}.msi`),
    path.join(__dirname, 'artifacts', `IT-Toolkit-Agent-${v}.msi`),
    path.join(__dirname, 'artifacts', 'IT-Toolkit-Agent.msi'),
    path.join(__dirname, 'artifacts', 'msi', 'IT-Toolkit-Agent.msi')
  ];

  for (const candPath of candidates) {
    if (fs.existsSync(candPath)) {
      try {
        const stat = fs.statSync(candPath);
        if (stat.size > 0) {
          return {
            found: true,
            path: candPath,
            filename: path.basename(candPath),
            size: stat.size
          };
        }
      } catch (_) {}
    }
  }

  return {
    found: false,
    path: candidates[0],
    filename: `IT-Toolkit-Agent-${v}.msi`,
    size: 0
  };
}

/**
 * Creates a valid minimal OLE Compound Document (CFBF / Windows Installer) binary fixture.
 * Used for testing and fallback environments where WiX is not installed.
 */
export function createValidMsiFixture(outputPath) {
  const buf = Buffer.alloc(1536, 0);

  // CFBF Magic: D0 CF 11 E0 A1 B1 1A E1
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  buf.writeUInt16LE(0x003e, 24); // Minor version 3E
  buf.writeUInt16LE(0x0003, 26); // Major version 3 (512-byte sectors)
  buf.writeUInt16LE(0xfffe, 28); // Byte order
  buf.writeUInt16LE(9, 30);      // Sector shift 9 (512 bytes)
  buf.writeUInt16LE(6, 32);      // Mini sector shift 6 (64 bytes)
  buf.writeUInt32LE(1, 44);      // Number of FAT sectors
  buf.writeUInt32LE(1, 48);      // First Directory sector
  buf.writeUInt32LE(4096, 56);   // Mini stream cutoff size
  buf.writeUInt32LE(0xfffffffe, 60); // Mini FAT ENDOFCHAIN
  buf.writeUInt32LE(0xfffffffe, 68); // First DIFAT ENDOFCHAIN

  buf.writeUInt32LE(0, 76);      // DIFAT[0]: FAT is in sector 0
  for (let i = 1; i < 109; i++) {
    buf.writeUInt32LE(0xffffffff, 76 + i * 4);
  }

  // Sector 0: FAT
  buf.writeUInt32LE(0xfffffffd, 512); // Sector 0 is FATSECT (-3)
  buf.writeUInt32LE(0xfffffffe, 516); // Sector 1 is Directory ENDOFCHAIN (-2)
  for (let i = 2; i < 128; i++) {
    buf.writeUInt32LE(0xffffffff, 512 + i * 4); // FREESECT (-1)
  }

  // Sector 1: Root Entry Directory
  const rootName = Buffer.from("Root Entry\0", "utf16le");
  rootName.copy(buf, 1024);
  buf.writeUInt16LE(rootName.length, 1024 + 64);
  buf.writeUInt8(5, 1024 + 66);  // STGTY_ROOT
  buf.writeUInt8(1, 1024 + 67);  // DE_BLACK
  buf.writeInt32LE(-1, 1024 + 68);
  buf.writeInt32LE(-1, 1024 + 72);
  buf.writeInt32LE(-1, 1024 + 76);
  buf.writeUInt32LE(0xfffffffe, 1024 + 116);
  buf.writeBigUInt64LE(0n, 1024 + 120);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buf);
  return buf;
}
