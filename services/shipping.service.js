export const PRODUCT_UNIT_WEIGHT_KG = 0.0211
export const MAX_SHIPPING_QUANTITY = 100

const DEFAULT_DIMENSIONS_CM = { width: 12, height: 2, length: 17 }

export function validateShippingQuantity(value = 1) {
  const quantity = Number(value)
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_SHIPPING_QUANTITY) {
    throw new Error(`A quantidade deve ser um número inteiro entre 1 e ${MAX_SHIPPING_QUANTITY}.`)
  }
  return quantity
}

export function getPackageWeight(quantity) {
  const safeQuantity = validateShippingQuantity(quantity)
  return Number((PRODUCT_UNIT_WEIGHT_KG * safeQuantity).toFixed(4))
}

export function correctLegacyPackageWeight(weight, quantity) {
  if (String(weight || "").trim() !== "0.5 kg") return weight
  return `${getPackageWeight(quantity)} kg`
}

function dimension(value, fallback) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback
}

export function normalizeCalculationShipment(shipment = {}) {
  if (!Array.isArray(shipment.products) || shipment.products.length === 0) {
    throw new Error("Informe ao menos um produto para calcular o frete.")
  }

  return {
    ...shipment,
    products: shipment.products.map((product) => ({
      ...product,
      quantity: validateShippingQuantity(product.quantity ?? 1),
      weight: PRODUCT_UNIT_WEIGHT_KG,
      ...DEFAULT_DIMENSIONS_CM
    }))
  }
}

export function normalizeOrderShipping(shipping = {}, quantity = 1) {
  const safeQuantity = validateShippingQuantity(quantity)
  const inputVolumes = Array.isArray(shipping.volumes) ? shipping.volumes : []
  const firstVolume = inputVolumes[0] || {}
  const volume = {
    weight: getPackageWeight(safeQuantity),
    width: dimension(firstVolume.width, DEFAULT_DIMENSIONS_CM.width),
    height: dimension(firstVolume.height, DEFAULT_DIMENSIONS_CM.height),
    length: dimension(firstVolume.length, DEFAULT_DIMENSIONS_CM.length)
  }

  return {
    ...shipping,
    products: Array.isArray(shipping.products)
      ? shipping.products.map((product) => ({
          ...product,
          quantity: safeQuantity,
          weight: PRODUCT_UNIT_WEIGHT_KG
        }))
      : [],
    volumes: [volume]
  }
}