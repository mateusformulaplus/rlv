import assert from "node:assert/strict"
import test from "node:test"
import {
  correctLegacyPackageDimensions,
  correctLegacyPackageWeight,
  getPackageDimensions,
  getPackageWeight,
  normalizeCalculationShipment,
  normalizeOrderShipping,
  resolveShippingQuantity,
  validateShippingQuantity
} from "./shipping.service.js"

test("calculates package weight from the unit weight and kit quantity", () => {
  for (const [quantity, expectedWeight] of [[1, 0.0211], [2, 0.0422], [3, 0.0633], [6, 0.1266]]) {
    assert.equal(getPackageWeight(quantity), expectedWeight)
  }
})

test("calculates compact package dimensions for every kit", () => {
  for (const [quantity, expected] of [
    [1, { width: 12, height: 3, length: 17 }],
    [2, { width: 24, height: 3, length: 17 }],
    [3, { width: 24, height: 3, length: 34 }],
    [6, { width: 36, height: 3, length: 34 }]
  ]) {
    assert.deepEqual(getPackageDimensions(quantity), expected)
  }
})

test("restores known kit quantities and fixes old list values", () => {
  assert.equal(resolveShippingQuantity(1, "kit-3"), 3)
  assert.equal(resolveShippingQuantity(1, "kit-4"), 6)
  assert.equal(correctLegacyPackageWeight("0.0211 kg", 6), "0.1266 kg")
  assert.equal(correctLegacyPackageDimensions("12x2x17 cm", 6), "36x3x34 cm")
})

test("rejects non-integer, non-finite, zero, negative and excessive quantities", () => {
  for (const quantity of [0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY, "invalid"]) {
    assert.throws(() => validateShippingQuantity(quantity), /quantidade/i)
  }
})

test("normalizes quote weight per item and corrects legacy fixed parcel weight", () => {
  const quote = normalizeCalculationShipment({
    products: [{ name: "Kit RLV", quantity: 3, weight: 0.5, width: 1, height: 1, length: 1 }]
  })
  const orderShipping = normalizeOrderShipping({
    products: [{ name: "Kit RLV", quantity: 3, weight: 0.5 }],
    volumes: [{ weight: 0.5, width: 12, height: 2, length: 17 }]
  }, 3)

  assert.deepEqual(quote.products[0], {
    name: "Kit RLV",
    quantity: 3,
    weight: 0.0211,
    width: 12,
    height: 3,
    length: 17
  })
  assert.equal(orderShipping.products[0].weight, 0.0211)
  assert.equal(orderShipping.volumes[0].weight, 0.0633)
  assert.equal(correctLegacyPackageWeight("0.5 kg", 3), "0.0633 kg")
  assert.equal(correctLegacyPackageWeight("0.0211 kg", 1), "0.0211 kg")
})