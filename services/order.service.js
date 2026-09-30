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

export async function saveOrder(order) {
	const { pagbankOrderId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = order
	const record = await getPrismaClient().order.upsert({
		where: { pagbankOrderId },
		create: { pagbankOrderId, data },
		update: { data }
	})
	return toOrder(record)
}

export async function findOrderByPagBankId(pagbankOrderId) {
	const record = await getPrismaClient().order.findUnique({ where: { pagbankOrderId } })
	return toOrder(record)
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
