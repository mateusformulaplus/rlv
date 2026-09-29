import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import {
	buyMelhorEnvioShipment,
	createMelhorEnvioShipment,
	getMelhorEnvioOrder,
	getMelhorEnvioShipmentLabel
} from "./melhor-envio.service.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDirectory = process.env.DATA_DIRECTORY
	? path.resolve(process.env.DATA_DIRECTORY)
	: path.resolve(__dirname, "../data")
const ordersPath = path.join(dataDirectory, "orders.json")


async function readOrders() {
	try {
		return JSON.parse(await readFile(ordersPath, "utf8"))
	} catch (error) {
		if (error.code === "ENOENT") return []
		throw error
	}
}

async function writeOrders(orders) {
	await mkdir(dataDirectory, { recursive: true })
	await writeFile(ordersPath, JSON.stringify(orders, null, 2), "utf8")
}

export async function saveOrder(order) {
	const orders = await readOrders()
	const existingIndex = orders.findIndex((item) => item.pagbankOrderId === order.pagbankOrderId)
	if (existingIndex >= 0) {
		orders[existingIndex] = { ...orders[existingIndex], ...order, updatedAt: new Date().toISOString() }
	} else {
		orders.push({ ...order, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
	}
	await writeOrders(orders)
	return orders[existingIndex >= 0 ? existingIndex : orders.length - 1]
}

export async function findOrderByPagBankId(pagbankOrderId) {
	const orders = await readOrders()
	return orders.find((order) => order.pagbankOrderId === pagbankOrderId) || null
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
