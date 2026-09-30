import { getPrismaClient } from "../lib/prisma.js"
import {
	buyMelhorEnvioShipment,
	createMelhorEnvioShipment,
	getMelhorEnvioOrder,
	getMelhorEnvioShipmentLabel
} from "./melhor-envio.service.js"

function toOrder(record) {
	if (!record) return null
	const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
		? record.data
		: {}

	return {
		...data,
		pagbankOrderId: record.pagbankOrderId,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString()
	}
}

export function toExpedicaoPedidoData(order) {
	const shipping = order.shipping || {}
	const address = shipping.to || {}
	const product = order.product || {}
	const volume = shipping.volumes?.[0] || {}
	const paymentStatus = String(order.status || "").toLowerCase()
	const paidStatuses = new Set(["paid", "authorized", "fulfilled", "shipment_created", "shipment_purchased"])
	const shippingStatus = order.melhorEnvioLabel
		? "Etiqueta disponível"
		: order.melhorEnvioPurchased
			? "Etiqueta comprada"
			: order.melhorEnvioShipmentId
				? "Remessa criada"
				: paidStatuses.has(paymentStatus)
					? "Aguardando envio"
					: "Aguardando pagamento"
	const street = address.address || address.street || "Rua não informada"
	const number = address.number || "S/N"
	const district = address.district || "Bairro não informado"
	const city = address.city || "Cidade não informada"
	const state = address.state_abbr || address.state || "SP"
	const postalCode = address.postal_code || address.cep || "00000-000"
	const shippingName = shipping.serviceName
		|| (shipping.service ? `Serviço ${shipping.service}` : "Não informado")
	const dimensions = [volume.width, volume.height, volume.length].every(Boolean)
		? `${volume.width}x${volume.height}x${volume.length} cm`
		: product.dimensions || "Não informado"

	return {
		codigoPedido: String(order.referenceId || order.pagbankOrderId),
		pagbankOrderId: order.pagbankOrderId,
		statusPagamento: paidStatuses.has(paymentStatus) ? "Pago" : "Pendente",
		clienteNome: String(order.customer?.name || address.name || "Cliente sem nome"),
		clienteTelefone: order.customer?.phone || address.phone || null,
		clienteEmail: order.customer?.email || null,
		produtoNome: String(product.name || order.productName || "Produto sem nome"),
		produtoQuantidade: Math.max(1, Number(product.quantity || order.quantity || 1)),
		enderecoRua: String(street),
		enderecoNumero: String(number),
		enderecoBairro: String(district),
		enderecoCidade: String(city),
		enderecoEstado: String(state),
		enderecoCep: String(postalCode),
		enderecoCompleto: [
			`${street}, ${number} - ${district}`,
			`${city}/${state}`,
			postalCode
		].join(", "),
		frete: String(shippingName),
		valorFrete: Number(order.shippingAmount || 0),
		statusExpedicao: shippingStatus,
		codigoRastreio: order.trackingCode || null,
		etiquetaDisponivel: Boolean(order.melhorEnvioLabel?.data || order.melhorEnvioLabelUrl),
		peso: volume.weight ? `${volume.weight} kg` : "0 kg",
		dimensoes: dimensions
	}
}

export async function syncOrderToExpedicao(order, prisma = getPrismaClient()) {
	if (!order.pagbankOrderId) return

	const pedido = toExpedicaoPedidoData(order)
	const conflictingCode = await prisma.expedicaoPedido.findUnique({ where: { codigoPedido: pedido.codigoPedido } })
	if (conflictingCode && conflictingCode.pagbankOrderId !== pedido.pagbankOrderId) {
		pedido.codigoPedido = `${pedido.codigoPedido}-${pedido.pagbankOrderId.slice(-6)}`
	}

	await prisma.expedicaoPedido.upsert({
		where: { pagbankOrderId: pedido.pagbankOrderId },
		create: pedido,
		update: pedido
	})
}

export async function saveOrder(order, prisma = getPrismaClient()) {
	const { pagbankOrderId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = order
	return prisma.$transaction(async (transaction) => {
		const record = await transaction.order.upsert({
			where: { pagbankOrderId },
			create: { pagbankOrderId, data },
			update: { data }
		})
		const savedOrder = toOrder(record)
		await syncOrderToExpedicao(savedOrder, transaction)
		return savedOrder
	})
}

export async function findOrderByPagBankId(pagbankOrderId) {
	const record = await getPrismaClient().order.findUnique({ where: { pagbankOrderId } })
	return toOrder(record)
}

export async function syncExistingOrdersToExpedicao() {
	const records = await getPrismaClient().order.findMany({ orderBy: { createdAt: "asc" } })
	let synced = 0
	let failed = 0

	for (const record of records) {
		try {
			await syncOrderToExpedicao(toOrder(record))
			synced += 1
		} catch (error) {
			failed += 1
			console.error("[Expedição] Falha no backfill PagBank:", error.code || error.name || "erro")
		}
	}

	return { total: records.length, synced, failed }
}

export async function fulfillPaidOrder(order) {
	let currentOrder = order

	if (!currentOrder.melhorEnvioShipmentId) {
		const shipment = await createMelhorEnvioShipment(currentOrder.shipping)
		currentOrder = await saveOrder({
			...currentOrder,
			status: "shipment_created",
			melhorEnvioShipmentId: shipment.id,
			melhorEnvioShipment: shipment
		})
	}

	if (!currentOrder.melhorEnvioPurchased) {
		const purchase = await buyMelhorEnvioShipment(currentOrder.melhorEnvioShipmentId)
		currentOrder = await saveOrder({
			...currentOrder,
			status: "shipment_purchased",
			melhorEnvioPurchased: true,
			melhorEnvioPurchase: purchase
		})
	}

	if (!currentOrder.melhorEnvioLabel) {
		const label = await getMelhorEnvioShipmentLabel(currentOrder.melhorEnvioShipmentId)
		currentOrder = await saveOrder({
			...currentOrder,
			melhorEnvioLabelUrl: label.url,
			melhorEnvioLabel: label
		})
	}

	const tracking = await getMelhorEnvioOrder(currentOrder.melhorEnvioShipmentId)
	return saveOrder({
		...currentOrder,
		status: "fulfilled",
		trackingCode: tracking.tracking || tracking.tracking_code || currentOrder.trackingCode || null,
		tracking
	})
}
