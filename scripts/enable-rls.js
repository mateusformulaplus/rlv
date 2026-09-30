import { getPrismaClient } from "../lib/prisma.js"

const tables = [
  "users",
  "expedicao_pedidos",
  "orders",
  "melhor_envio_credentials",
  "melhor_envio_oauth_states"
]


const prisma = getPrismaClient()

try {
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`)
  }
  console.log("RLS ativado nas tabelas privadas do schema public.")
} finally {
  await prisma.$disconnect()
}