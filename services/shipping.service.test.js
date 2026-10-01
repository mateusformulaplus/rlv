import assert from "node:assert/strict"
import test from "node:test"
import {
  getPackageWeight,
  normalizeCalculationShipment,
  normalizeOrderShipping,
  correctLegacyPackageWeight,
  validateShippingQuantity
} from "./shipping.service.js"

test("calculates package weight from the unit weight and kit quantity", () => {
  for (const [quantity, expectedWeight] of [[1, 0.0211], [2, 0.0422], [3, 0.0633], [6, 0.1266]]) {
    assert.equal(getPackageWeight(quantity), expectedWeight)
  }
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
    height: 2,
    length: 17
  })
  assert.equal(orderShipping.products[0].weight, 0.0211)
  assert.equal(orderShipping.volumes[0].weight, 0.0633)
  assert.equal(correctLegacyPackageWeight("0.5 kg", 3), "0.0633 kg")
  assert.equal(correctLegacyPackageWeight("0.0211 kg", 1), "0.0211 kg")
})