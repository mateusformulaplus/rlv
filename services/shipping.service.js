export const PRODUCT_UNIT_WEIGHT_KG = 0.0211
export const MAX_SHIPPING_QUANTITY = 100

const DEFAULT_DIMENSIONS_CM = { width: 12, height: 3, length: 17 }
const KIT_QUANTITIES = { "kit-1": 1, "kit-2": 2, "kit-3": 3, "kit-4": 6 }

export function validateShippingQuantity(value = 1) {
  const quantity = Number(value)
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_SHIPPING_QUANTITY) {
    throw new Error(`A quantidade deve ser um número inteiro entre 1 e ${MAX_SHIPPING_QUANTITY}.`)
  }
  return quantity
}

export function resolveShippingQuantity(quantity, referenceId) {
  return KIT_QUANTITIES[String(referenceId || "").toLowerCase()] || validateShippingQuantity(quantity)
}

export function getPackageWeight(quantity) {
  const safeQuantity = validateShippingQuantity(quantity)
  return Number((PRODUCT_UNIT_WEIGHT_KG * safeQuantity).toFixed(4))
}

export function getPackageDimensions(quantity, unitDimensions = DEFAULT_DIMENSIONS_CM) {
  const safeQuantity = validateShippingQuantity(quantity)
  const columns = Math.ceil(Math.sqrt(safeQuantity))
  const rows = Math.ceil(safeQuantity / columns)

  return {
    width: dimension(unitDimensions.width, DEFAULT_DIMENSIONS_CM.width) * columns,
    height: dimension(unitDimensions.height, DEFAULT_DIMENSIONS_CM.height),
    length: dimension(unitDimensions.length, DEFAULT_DIMENSIONS_CM.length) * rows
  }
}

export function correctLegacyPackageWeight(weight, quantity) {
  if (!["0.5 kg", `${PRODUCT_UNIT_WEIGHT_KG} kg`].includes(String(weight || "").trim())) return weight
  return `${getPackageWeight(quantity)} kg`
}

export function correctLegacyPackageDimensions(dimensions, quantity) {
  if (!["12x2x17 cm", "10x2x15 cm"].includes(String(dimensions || "").trim())) return dimensions
  const packageDimensions = getPackageDimensions(quantity)
  return `${packageDimensions.width}x${packageDimensions.height}x${packageDimensions.length} cm`
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
  const unitDimensions = DEFAULT_DIMENSIONS_CM
  const volume = {
    weight: getPackageWeight(safeQuantity),
    ...getPackageDimensions(safeQuantity, unitDimensions)
  }

  return {
    ...shipping,
    products: Array.isArray(shipping.products)
      ? shipping.products.map((product) => ({
          ...product,
          quantity: safeQuantity,
          weight: PRODUCT_UNIT_WEIGHT_KG,
          ...unitDimensions
        }))
      : [],
    volumes: [volume]
  }
}