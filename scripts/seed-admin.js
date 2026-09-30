import dotenv from "dotenv"
import bcrypt from "bcryptjs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getPrismaClient } from "../lib/prisma.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, "../config/.env") })

const username = process.env.EXPEDICAO_USER?.trim()
const password = process.env.EXPEDICAO_PASS
const displayName = process.env.EXPEDICAO_NAME?.trim() || "Administrador"
const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username || "") && username.length <= 254
const isUsername = /^[a-zA-Z0-9._-]{3,40}$/.test(username || "")

if (!username || (!isEmail && !isUsername)) {
  throw new Error("Defina EXPEDICAO_USER como usuário válido ou email em config/.env.")
}

if (!password || password.length < 12) {
  throw new Error("Defina EXPEDICAO_PASS com pelo menos 12 caracteres em config/.env.")
}

const passwordHash = await bcrypt.hash(password, 12)
const prisma = getPrismaClient()

try {
  await prisma.user.upsert({
    where: { username },
    create: { username, displayName, passwordHash, role: "admin", active: true },
    update: { displayName, passwordHash, role: "admin", active: true }
  })
  console.log(`Administrador '${username}' configurado na tabela users.`)
} finally {
  await prisma.$disconnect()
}