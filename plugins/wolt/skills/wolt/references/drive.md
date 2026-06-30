# Wolt Drive API

Official reference: https://developer.wolt.com/docs/api/wolt-drive

Drive uses a separate merchant key, not the marketplace OAuth JWT.

- `drive_create_shipment_promise`: quote a venueful delivery; only binding promises can create deliveries.
- `drive_create_delivery`: create a venueful delivery from an eligible promise.
- `drive_get_available_venues`: find merchant venues serving a destination.
- `drive_get_delivery_fee`: quote a venueless delivery.
- `drive_create_delivery_order`: create a venueless delivery order.

Delivery creation can create operational and financial obligations. Verify recipient, pickup, dropoff, parcel, and cash details before confirming production.
