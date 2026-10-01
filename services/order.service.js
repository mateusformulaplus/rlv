import { getPrismaClient } from "../lib/prisma.js"
import { normalizeOrderShipping, resolveShippingQuantity } from "./shipping.service.js"
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
	const product = order.product || {}
	const quantity = resolveShippingQuantity(product.quantity ?? order.quantity ?? 1, order.referenceId)
	const shipping = normalizeOrderShipping(order.shipping || {}, quantity)
	const address = shipping.to || {}
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
		produtoQuantidade: quantity,
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

export function toExpedicaoOrderDetails(order) {
	if (!order) return null

	const quantity = resolveShippingQuantity(order.product?.quantity ?? order.quantity ?? 1, order.referenceId)
	const charges = Array.isArray(order.pagbank?.charges) ? order.pagbank.charges : []
	const paidCharge = charges.find((charge) => String(charge.status).toUpperCase() === "PAID")
	const charge = paidCharge || charges[0] || {}
	const shipping = normalizeOrderShipping(order.shipping || {}, quantity)
	const tracking = order.tracking || {}
	const amountInCents = Number(charge.amount?.value)

	return {
		transactionId: order.pagbankOrderId,
		referenceId: order.referenceId || null,
		orderStatus: order.status || null,
		createdAt: order.createdAt || null,
		chargeId: charge.id || order.pagbankChargeId || null,
		paymentStatus: charge.status || order.status || null,
		paymentMethod: charge.payment_method?.type || order.paymentMethod || null,
		paidAt: paidCharge?.paid_at || null,
		paidAmount: Number.isFinite(amountInCents) ? amountInCents / 100 : null,
		product: {
			name: order.product?.name || order.productName || null,
			quantity: Number(order.product?.quantity || order.quantity || 1),
			unitAmount: Number(order.product?.amount || 0)
		},
		customer: {
			name: order.customer?.name || null,
			email: order.customer?.email || null,
			phone: order.customer?.phone || order.customer?.mobile || null
		},
		shipping: {
			serviceName: shipping.serviceName || (shipping.service ? `Serviço ${shipping.service}` : null),
			serviceId: shipping.service || null,
			amount: Number(order.shippingAmount || 0),
			address: shipping.to || {},
			volumes: Array.isArray(shipping.volumes) ? shipping.volumes : []
		},
		melhorEnvio: {
			shipmentId: order.melhorEnvioShipmentId || null,
			purchased: Boolean(order.melhorEnvioPurchased),
			labelAvailable: Boolean(order.melhorEnvioLabel?.data || order.melhorEnvioLabelUrl),
			trackingCode: order.trackingCode || tracking.tracking || tracking.tracking_code || null,
			status: tracking.status || order.melhorEnvioShipment?.status || null
		}
	}
}

export async function syncOrderToExpedicao(order, prisma = getPrismaClient()) {
	if (!order.pagbankOrderId) return

	const pedido = toExpedicaoPedidoData(order)
	const existingOrder = await prisma.expedicaoPedido.findUnique({
		where: { pagbankOrderId: pedido.pagbankOrderId },
		select: { statusExpedicao: true }
	})
	if (existingOrder?.statusExpedicao === "Enviado") {
		pedido.statusExpedicao = "Enviado"
	}

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
