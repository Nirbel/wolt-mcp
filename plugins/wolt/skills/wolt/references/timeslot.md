# Time slot configuration API

Official reference: https://developer.wolt.com/docs/api/timeslot-orders

- `timeslot_get`: retrieve configuration and effective slots for the next seven days.
- `timeslot_upsert`: replace or create the venue's timeslot configuration.
- `timeslot_update_capacity`: patch configured capacities; setting capacity to zero removes a slot.

Wolt must enable this API for the venue before use.
