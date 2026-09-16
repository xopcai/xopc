export function containsSecret(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16})\b/i.test(text)
    || /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)\s*[=:]\s*["']?(?!\$|<|\{|process\.env|os\.environ)[a-zA-Z0-9_+/.-]{12,}/i.test(text);
}

export function isCredentialPath(path: string): boolean {
  return /(^|\/)(\.env(?:\..*)?|auth\.json|credentials[^/]*|id_rsa|id_ed25519)$/i.test(path);
}
