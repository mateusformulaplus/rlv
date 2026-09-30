import bcrypt from "bcryptjs"
import { getPrismaClient } from "../lib/prisma.js"

const username = process.env.EXPEDICAO_USER?.trim()
const password = process.env.EXPEDICAO_PASS
const displayName = process.env.EXPEDICAO_NAME?.trim() || "Administrador"
const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username || "") && username.length <= 254
const isUsername = /^[a-zA-Z0-9._-]{3,40}$/.test(username || "")

if (!username || (!isEmail && !isUsername)) {
  throw new Error("Para o bootstrap inicial, forneça EXPEDICAO_USER temporariamente no ambiente do processo.")
}

if (!password || password.length < 12) {
  throw new Error("Para o bootstrap inicial, forneça EXPEDICAO_PASS temporariamente com pelo menos 12 caracteres.")
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