import assert from "node:assert/strict"
import test from "node:test"
import {
  correctLegacyPackageDimensions,
  correctLegacyPackageWeight,
  getPackageDimensions,
  getPackageWeight,
  isValidPostalCode,
  normalizeCalculationShipment,
  normalizeOrderShipping,
  resolveShippingQuantity,
  validateShippingQuantity
} from "./shipping.service.js"

test("validates 8-digit postal codes and rejects invalid or repetitive sequences", () => {
  assert.equal(isValidPostalCode("01001-000"), true)
  assert.equal(isValidPostalCode("01001000"), true)
  assert.equal(isValidPostalCode("00000000"), false)
  assert.equal(isValidPostalCode("11111111"), false)
  assert.equal(isValidPostalCode("123"), false)
  assert.equal(isValidPostalCode(""), false)
})

test("calculates package weight from the unit weight and kit quantity", () => {
  for (const [quantity, expectedWeight] of [[1, 0.0211], [2, 0.0422], [3, 0.0633], [6, 0.1266]]) {
    assert.equal(getPackageWeight(quantity), expectedWeight)
  }
})

test("uses the measured package dimensions for each kit quantity", () => {
  for (const [quantity, expected] of [
    [1, { width: 12, height: 18, length: 2 }],
    [2, { width: 12, height: 18, length: 2.5 }],
    [3, { width: 12, height: 18, length: 3 }],
    [6, { width: 12, height: 18, length: 4 }]
  ]) {
    assert.deepEqual(getPackageDimensions(quantity), expected)
  }
})

test("restores known kit quantities and fixes old list values", () => {
  assert.equal(resolveShippingQuantity(1, "kit-3"), 3)
  assert.equal(resolveShippingQuantity(1, "kit-4"), 6)
  assert.equal(correctLegacyPackageWeight("0.0211 kg", 6), "0.1266 kg")
  assert.equal(correctLegacyPackageDimensions("12x2x17 cm", 6), "12x18x4 cm")
  assert.equal(correctLegacyPackageDimensions("12x3x17 cm", 1), "12x18x2 cm")
  assert.equal(correctLegacyPackageDimensions("12x18x17 cm", 1), "12x18x2 cm")
})

test("rejects non-integer, non-finite, zero, negative and excessive quantities", () => {
  for (const quantity of [0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY, "invalid"]) {
    assert.throws(() => validateShippingQuantity(quantity), /quantidade/i)
  }
})

test("normalizes quotes to package dimensions and total package weight", () => {
  const quote = normalizeCalculationShipment({
    products: [{ name: "Kit RLV", quantity: 3, weight: 0.5, width: 1, height: 1, length: 1 }]
  })
  const orderShipping = normalizeOrderShipping({
    products: [{ name: "Kit RLV", quantity: 3, weight: 0.5 }],
    volumes: [{ weight: 0.5, width: 12, height: 2, length: 17 }]
  }, 3)

  assert.deepEqual(quote.products[0], {
    name: "Kit RLV",
    quantity: 1,
    weight: 0.0633,
    width: 12,
    height: 18,
    length: 3
  })
  assert.equal(orderShipping.products[0].weight, 0.0211)
  assert.equal(orderShipping.volumes[0].weight, 0.0633)
  assert.equal(correctLegacyPackageWeight("0.5 kg", 3), "0.0633 kg")
  assert.equal(correctLegacyPackageWeight("0.0211 kg", 1), "0.0211 kg")
})