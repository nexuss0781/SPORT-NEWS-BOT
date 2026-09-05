# teleproto API notes — for copy-as-is message posting

Researched: 2026-09-05. Goal: replace download + re-upload (Bot API) with an
exact server-side MTProto copy of source messages (incl. albums), for the
Reels publish + auto-monitor publish paths.

## 1. Which lib is installed / why

- `telegram@2.26.22` is already a dependency and stays for:
  - monitoring source channels (`createMonitorClient`, `fetchGroupedMedia`, `downloadMedia`)
  - Bot API posting (`src/services/publisher.ts`)
  - admin UI (`bot.on`, `replyWithMediaGroup`, etc.)
- `teleproto@1.229.0` (latest, actively maintained successor of gramjs) was
  **added** purely for the server-side copy operation.
  - Install line (already applied): `npm install teleproto@latest`
- Both libs coexist: keep `telegram` for everything existing, use `teleproto`
  only in the new copy service. Only essential parts were touched.

## 2. Key API finding — there is NO `messages.copyMessages` TL method anywhere

- `Api.messages.CopyMessages` does **not** exist in teleproto's schema
  (checked at runtime + `tl/generated/api.d.ts`). Same for `telegram@2.26.22`.
- `client.copyMessages(entity, params)` **does** exist in teleproto and is a
  client-level convenience that internally calls:
  `forwardMessages()` with `dropAuthor: true`.
- `forwardMessages` with `dropAuthor: true` produces a **server-side copy**
  with **no "Forwarded from" header** — i.e. exactly a copy, the way copyMessage
  works on the Bot API. It does not download/upload anything.
- `Api.messages.ForwardMessages` **is** in the schema (layer-176v2 bump).
- Because copy happens server-side, albums stay grouped when all album
  message IDs are passed in one call.

### copyMessages signature (teleproto client/messages.js `copyMessages`)

```ts
client.copyMessages(entity, {
  messages,          // MessageIDLike | MessageIDLike[] (ids of source msgs)
  fromPeer,          // source peer: "@username" | "https://t.me/username" | id | Api.InputPeer
  ...ForwardMessagesParams (silent, schedule, noforwards, topMsgId, sendAs, effect, dropMediaCaptions, withMyScore, ...)
})
```

- `fromPeer` is **required** when `messages` are numeric IDs.
- Groups `messages` by chat id internally (`groupBy(messages, getKey)`), then
  for each group it does ONE `Api.messages.ForwardMessages` with the id array.
  → pass every album id (base + the rest of the group) in the same call so the
  destination album is preserved.

### forwardMessages / ForwardMessagesParams fields (client/messages.d.ts:208)

```ts
messages: MessageIDLike | MessageIDLike[];
fromPeer: EntityLike;
silent?: boolean;
schedule?: DateLike;
noforwards?: boolean;
dropAuthor?: boolean;        // ← copyMessages forces true = "copy, no forward header"
topMsgId?: number;
sendAs?: EntityLike;         // post "as" another entity (channel username), if allowed
effect?: bigint | BigInteger;// animated emoji effect id
dropMediaCaptions?: boolean; // if true, drop media captions when copying
withMyScore?: boolean;
background?: boolean;
allowPaidFloodskip?: boolean;
allowPaidStars?: boolean;
videoTimestamp?: number;
replyTo?: ReplyTo;
scheduleRepeatPeriod?: number;
quickReplyShortcut?: number;
suggestedPost?: boolean;
```

Returns `Promise<Api.Message[]>` (the copied messages).

### editMessage (client/messages.d.ts:248) — used to set caption after copy

```ts
client.editMessage(entity, {
  message: number | Api.Message,
  text?: string,
  parseMode?: string,          // "md" | "html"; ignored if formattingEntities given
  formattingEntities?: Api.TypeMessageEntity[],
  linkPreview?: boolean,
  file?: FileLike, forceDocument?: boolean,
  buttons?: MarkupLike,        // only works for bot accounts' own messages
  schedule?, invertMedia?, scheduleRepeatPeriod?, quickReplyShortcutId?, richMessage?,
})
```

- If `message` is a number, you must provide `text` or `file` or `schedule`
  (else throws: "You have to provide either file or text or schedule property.").
- If `message` is an `Api.Message` instance, its text/entities/media/replyMarkup
  are reused (useful to re-send a source message with tweaks).
- `formattingEntities` is the array of MTProto entities; when provided,
  `parseMode` is ignored.

### Sessions

```ts
import { TelegramClient, Api } from "teleproto";
import { StringSession, MemorySession, StoreSession, Session } from "teleproto/sessions";

new TelegramClient(new StringSession(TELEGRAM_SESSION), apiId, apiHash, {});
await client.connect();
// ...
await client.disconnect();
```

- `StringSession` is the drop-in for the existing `TELEGRAM_SESSION` env value
  (same string format the `telegram` lib uses).
- Constructor throws for other session types unless adapters exist
  ("Only StringSession and StoreSessions are supported" seen in source docs).
- TelegramClient exposes `getInputEntity`, `getPeerId`, `invoke`, `copyMessages`,
  `editMessage`, `forwardMessages` — mirrors gramjs surface so migration is small.

## 3. Entity for premium emoji in caption (after copy)

MTProto (not Bot API):

```ts
new Api.MessageEntityCustomEmoji({
  offset: number,   // char offset in the caption text
  length: number,   // length of the emoji sequence
  documentId: long, // the emoji's document_id (NOT the Bot API custom_emoji_id)
})
```

- Input interface `MessageEntityCustomEmojiIn` (api.d.ts:43135) declares
  `documentId: long` (i.e. `BigInteger` at the TS type level).
- **At runtime it still accepts native `bigint`** (verified: constructed with
  `BigInt(12345)` → `e.documentId === 12345n`, typeof `bigint`, has toString).
- TS with `strict` will complain passing native `bigint`:
  `error TS2322: Type 'bigint' is not assignable to type 'BigInteger'`.
  → cast: `documentId: BigInt(id) as any` (or import `big-integer`).
- Data model already stores `CustomEmoji { emojiChar, emojiId }` as `string`
  (Bot API custom_emoji_id). For MTProto we need the **document_id** instead.
  The copied message's caption entities already carry the correct
  `MessageEntityCustomEmoji.documentId`; prefer reading it from the copied
  message (edit the copied message with its own kept entities and swap only
  the text), or resolve `custom_emoji_id → document_id` via
  `messages.getCustomEmojiDocuments` before editing.

## 4. Typecheck / TS notes

- Project tsconfig already has `"esModuleInterop": true` and
  `"skipLibCheck": true` — required for teleproto (its `.d.ts` default-imports
  `big-integer`; without skipLibCheck the following surface on typecheck):
  ```
  node_modules/teleproto/Helpers.d.ts(1,8): error TS1259: Module big-integer can only be default-imported using the 'esModuleInterop' flag
  node_modules/teleproto/client/downloads.d.ts ... (same class of errors)
  ```
- Compiling a single throwaway file with `npx tsc --noEmit file.ts` ignores
  tsconfig → always add the import inside `src/` and run the project-wide
  `npx tsc --noEmit`.

## 5. Runtime probes done

- `require('teleproto')` exposes `{ TelegramClient, Api, client }`.
- `require('teleproto/client/messages')` exports `forwardMessages`, `editMessage`,
  `copyMessages` only.
- `Api.messages` has 355 keys; `Api` root ~1416 keys; no `CopyMessages`.
- `api.messages.AffectedMessages` is the result type of ForwardMessages invoke;
  `copyMessages` maps the returned `updates` to `Api.Message[]` via
  `Entities.getMessages(updates)`.
- `Api.MessageEntityCustomEmoji` is a real constructor (CONSTRUCTOR_ID 3369010680).

## 6. Summary of HOW the copy path is wired (see src/services/copyService.ts)

- `copySourceToTargets({ sourceChannel, sourceGroupedMedia?, baseMessageId,
  content, signatureEmoji?, targetChannels })`:
  1. connect teleproto client with `config.telegramSession`
  2. resolve source peer + target peers via `getInputEntity`
  3. `copyMessages(target, { messages: allSourceIds, fromPeer: source })`
     → exact copy incl. album; no forward header (dropAuthor)
  4. `editMessage(target, { message: firstCopiedId, text: content,
     formattingEntities })` → apply translation + signature + emoji
  5. disconnect
- Fallback (any error / source copy not available) → existing
  `sendMediaGroup`/`sendMedia` download+re-upload path.
- Config unchanged: `TELEGRAM_SESSION`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`.