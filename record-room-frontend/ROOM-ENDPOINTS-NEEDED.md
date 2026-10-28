# Room add / edit / delete: API contract (implemented)

> Implemented in `dotnet-api` (`LocationsController` / `LocationsService`). Kept as the contract reference.

The UI (Record rooms → Add room, Edit, Delete) works in local mode and calls these three endpoints in http mode.

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/locations/rooms` | `{ name, building, floor, status, capacity }` | the new room (same shape as `GET /api/locations/rooms/{id}`) |
| PUT | `/api/locations/rooms/{id}` | same fields, all optional | the updated room |
| DELETE | `/api/locations/rooms/{id}` | none | `{ ok: true }` |

Rules the local adapter follows (mirror them in `LocationsService`):
- `name` is required and unique (case-insensitive); the code is generated as `RM-001`, `RM-002`, ...
- `status` is `Operational`, `Restricted` or `Maintenance`; `capacity` defaults to 100.
- Delete is refused while the room still has sections or almirahs, or any file records it.
  Return a `Result.Fail(message, "roomId")` so the UI can show the message.
- Writes go to the audit trail like the section endpoints do.
Restrict all three to the roles that have `locations.edit` (Admin, Supervisor).
