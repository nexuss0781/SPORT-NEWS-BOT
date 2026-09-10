import { Context } from "grammy";
import { isOwner } from "../services/roles";
import {
  getChannels,
  addChannel,
  removeChannel,
  getConfig,
  updateConfig,
} from "../services/storage";
import { toChannelUrl } from "../services/mtproto";
import { Channel } from "../types";
import { config, transitionEnabled } from "../config";

export function adminOnly(ctx: Context, next: () => Promise<void>): Promise<void> {
  return (async () => {
    const userId = ctx.from?.id;
    if (!userId || !(await isOwner(userId, ctx.from?.username))) {
      await ctx.reply("⛔ You are not authorized to use this command.");
      return;
    }
    await next();
  })();
}

export function registerAdminCommands(bot: any): void {
  // Add channel(s) to monitor (multiple separated by comma or space)
  bot.command("addchannel", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /addchannel @ch1 @ch2 @ch3\n\nMultiple separated by comma or space.");
      return;
    }

    const raw = args.join(" ");
    const usernames = raw
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
      .map(toChannelUrl);

    let added = 0;
    for (const username of usernames) {
      const exists = (await getChannels()).some(
        (c) => c.username.toLowerCase() === username.toLowerCase()
      );
      if (exists) continue;
      const channel: Channel = {
        id: username,
        username,
        addedAt: new Date().toISOString(),
        addedBy: ctx.from!.id,
      };
      await addChannel(channel);
      added++;
    }

    const channels = await getChannels();
    ctx.reply(`✅ Added ${added} source channel(s).\n\nTotal monitored: ${channels.length}`);
  });

  // Remove channel
  bot.command("removechannel", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /removechannel @channel_username");
      return;
    }

    const username = toChannelUrl(args[0]);

    const channels = await removeChannel(username);
    ctx.reply(`✅ Channel ${username} removed.\n\nTotal monitored: ${channels.length}`);
  });

  // List channels
  bot.command("listchannels", adminOnly, async (ctx: Context) => {
    const channels = await getChannels();
    if (channels.length === 0) {
      ctx.reply("No channels being monitored.\n\nUse /addchannel @channel to add one.");
      return;
    }

    const list = channels
      .map((c, i) => `${i + 1}. ${c.username} (added ${new Date(c.addedAt).toLocaleDateString()})`)
      .join("\n");
    ctx.reply(`📺 Monitored Channels (${channels.length}):\n\n${list}`);
  });

  // Set target channel(s) (multiple separated by comma or space, replaces list)
  bot.command("settarget", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /settarget @ch1 @ch2\n\nMultiple separated by comma or space. Replaces current targets.");
      return;
    }

    const raw = args.join(" ");
    const usernames = raw
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => (u.startsWith("@") ? u : `@${u.replace(/^https?:\/\/t\.me\//i, "")}`));

    const unique = [...new Set(usernames)];
    await updateConfig({ targetChannels: unique, targetChannel: unique[0] });
    ctx.reply(`✅ Target channel(s) set:\n\n${unique.join("\n")}\n\nTotal: ${unique.length}`);
  });

  // Set signature
  bot.command("setsignature", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /setsignature Your signature text here\n\nExample: /setsignature Share @mychannel on every post footer");
      return;
    }

    const signature = args.join(" ");
    await updateConfig({ signature });
    ctx.reply(`✅ Signature set to:\n\n${signature}`);
  });

  // Get signature
  bot.command("getsignature", adminOnly, async (ctx: Context) => {
    const cfg = await getConfig();
    if (cfg.signature) {
      ctx.reply(`Current signature:\n\n${cfg.signature}`);
    } else {
      ctx.reply("No signature set.\n\nUse /setsignature to add one.");
    }
  });

  // Status
  bot.command("status", adminOnly, async (ctx: Context) => {
    const cfg = await getConfig();
    const channels = await getChannels();

    // Transition-mode health: who is answering right now (this command runs on
    // whichever host owns the updates) and whether Render is up.
    let health = "";
    if (transitionEnabled) {
      try {
        const [renderJson, webhookInfo] = await Promise.all<[unknown, string]>([
          fetch(`${config.renderUrl}/status`, { signal: AbortSignal.timeout(8000) })
            .then((r) => (r.json() as Promise<unknown>).catch(() => null))
            .catch(() => null),
          bot.api.getWebhookInfo().then((r: { url: string }) => r.url || "").catch(() => ""),
        ]);
        const rj = renderJson as { status?: string; mode?: string } | null;

        const renderState = rj?.status === "ok"
          ? rj.mode === "polling"
            ? "🟢 ON — polling (serving)"
            : "🟡 standby (idle)"
          : "🔴 OFF / unreachable";
        const responder = webhookInfo.endsWith("/api/bot")
          ? "Vercel (webhook)"
          : webhookInfo && webhookInfo.length > 0
            ? "other webhook"
            : "Render (long-poll)";

        health = [
          "",
          "════════ HEALTH ═══════",
          `👀 Responder: ${responder}`,
          `⚙️ Render: ${renderState}`,
          "════════════════════════",
        ].join("\n");
      } catch {
        health = "";
      }
    }

    const status = [
      "🤖 Bot Status",
      "",
      `📥 Source Channels: ${channels.length}`,
      `📤 Target Channels: ${cfg.targetChannels.length ? cfg.targetChannels.join(", ") : "Not set"}`,
      `✍️ Signature: ${cfg.signature || "Not set"}`,
      `🌐 Translation Lang: ${cfg.translatedLang}`,
      health,
      "",
      "Channel Commands:",
      "/english - Show English + Amharic (reply to post)",
      "/original - Show Original + Translation (reply to post)",
      "",
      "Admin Commands:",
      "/addchannel @channel - Add channel",
      "/removechannel @channel - Remove channel",
      "/listchannels - List channels",
      "/settarget @channel - Set output channel",
      "/setsignature text - Set footer",
      "/refresh - Scan sources & fire due reels now",
    ].join("\n");

    ctx.reply(status);
  });

  // Manually trigger a monitor scan (same work the cron does): check source
  // channels for new posts, queue/publish them, and fire due scheduled reels.
  bot.command("refresh", adminOnly, async (ctx: Context) => {
    const started = Date.now();
    await ctx.reply("🔄 Refreshing… scanning sources & firing due reels.");

    let summary: string;
    try {
      const { runMonitorScan } = await import("../services/monitorScan");
      const result = await runMonitorScan(bot);

      const ok = result.results.filter((r) => r.ok).length;
      const failed = result.results.filter((r) => !r.ok);

      if (result.message) {
        summary = `⚠️ ${result.message}`;
      } else if (result.processed === 0) {
        summary = "✅ Nothing new to process.";
      } else {
        const lines: string[] = [];
        for (const r of result.results.slice(0, 12)) {
          if (r.ok && r.skipped) lines.push(`➖ ${r.channel} #${r.messageId}: skipped (${r.skipped})`);
          else if (r.ok && r.scheduled) lines.push(`⏰ ${r.channel} #${r.messageId}: scheduled reel posted`);
          else if (r.ok) lines.push(`✔️ ${r.channel} #${r.messageId}`);
          else lines.push(`❌ ${r.channel} #${r.messageId}: ${r.error}`);
        }
        if (failed.length) lines.push(`\n${failed.length} failed`);
        summary = `✅ Processed ${result.processed} item(s):\n${lines.join("\n")}`;
      }
    } catch (error: any) {
      summary = `❌ Refresh failed: ${String(error?.message || error)}`;
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    await ctx.reply(`${summary}\n\n⏱ ${elapsed}s`);
  });
}