# Venue API

Official reference: https://developer.wolt.com/docs/api/venue

- `venue_get_status` and `venue_get_settings` inspect venue health and configuration.
- `venue_get_delivery_provider` returns `WOLT` or `SELF_DELIVERY`.
- `venue_update_delivery_provider` changes provider only for hybrid-delivery venues.
- `venue_set_online_status` sets `ONLINE` or `OFFLINE`; `until` is only supported for temporary offline periods.
- `venue_update_opening_times` replaces regular availability spans.
- `venue_set_special_opening_times` replaces the full future exception list.

Special opening ranges must not overlap or place one date in both open and closed lists. Times are interpreted in the venue's local timezone.
