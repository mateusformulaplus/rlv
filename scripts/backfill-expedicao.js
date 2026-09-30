import { getPrismaClient } from "../lib/prisma.js"
import { syncExistingOrdersToExpedicao } from "../services/order.service.js"

const prisma = getPrismaClient()

try {
  const result = await syncExistingOrdersToExpedicao()
  console.log(`Pedidos encontrados: ${result.total}`)
  console.log(`Pedidos sincronizados: ${result.synced}`)
  console.log(`Falhas: ${result.failed}`)
  if (result.failed) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
