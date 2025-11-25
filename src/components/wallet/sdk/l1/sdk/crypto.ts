import CryptoJS from "crypto-js"

export function encrypt(text: string, password: string): string {
  return CryptoJS.AES.encrypt(text, password).toString()
}

export function decrypt(encrypted: string, password: string): string {
  const bytes = CryptoJS.AES.decrypt(encrypted, password)
  return bytes.toString(CryptoJS.enc.Utf8)
}

export function generatePrivateKey(): string {
  return CryptoJS.lib.WordArray.random(32).toString()
}
