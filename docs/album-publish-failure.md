# Album publish failure — diagnosis & fix (2026-09-05)

## Symptoms
Posting an album with a caption failed. Production webhook logs showed two
consecutive failures (copy path, then its fallback):

```
[reels] copy to @united_editor failed: editMessageParams.message must be either a number or a Api.Message type
[reels] publish to @united_editor failed: Unsupported media value
```

## Root cause 1 — teleproto copy: wonky returned message id
`copyService.ts` fed the copied message id straight into `editMessage`:

```ts
const copied = await client.copyMessages(targetPeer, { messages, fromPeer, dropMediaCaptions });
const first = Array.isArray(copied) ? copied[0] : copied;
const copiedId = first.id;         // <-- unreliable
await client.editMessage(targetPeer, { message: copiedId, text, formattingEntities });
```

Teleproto's `_getResponseMessage` (node_modules/teleproto/client/messageParse.js)
may return:
- a single `Api.Message`,
- an `idToMessage` (`Map`), or
- `undefined` (when the request has no usable `randomId` mapping).

`Api.Message.id` for copies is also surfaced as a big-int in some paths.
`editMessage` accepts **only** `number | Api.Message` — big-int or `undefined`
throws `editMessageParams.message must be either a number or a Api.Message type`.

Fix: normalize the returned value into a valid integer id before editing, or
give the whole target an explicit failure so the download/re-upload fallback
runs. Never pass `first.id` through unvalidated.

## Root cause 2 — fallback re-upload: JSON-round-tripped Buffers
When the copy failed the fallback re-posts stored media from
`item.sourceGroupedMedia`. MediaPayload `value` is a `Buffer`, but reels are
persisted as JSON (`src/services/storage.ts`), so a `Buffer` comes back as a
plain `{type:"Buffer", data:[...]}` object. `toBuffer()` in `publisher.ts`
(and `Buffer.from(...)` in `callbacks.ts` `toBotInput`) reject that shape with
`Unsupported media value`.

Note: a freshly downloaded `downloadMedia` result could also arrive as
`Uint8Array`/`ArrayBuffer` — both must be convertible.

Fix: in `toBuffer`/`toBotInput` accept
`Buffer | {type:"Buffer", data:[...]} | ArrayBuffer | ArrayBufferView`, log the
actual `value` type on failure to make future mismatches visible.

## Fix summary
1. `src/services/copyService.ts` — robust id extraction + validation before
   `editMessage`; explicit failure per target otherwise.
2. `src/services/publisher.ts` — `toBuffer()` accepts round-tripped Buffer
   objects and ArrayBuffer/views; logs offending type on error.
3. `src/handlers/callbacks.ts` — `toBotInput()` handles the same shapes for
   stored `addedMedia`/`sourceGroupedMedia` buffers (preview cards).
4. Re-deploy and verify via `/api/diag` + a real album publish.