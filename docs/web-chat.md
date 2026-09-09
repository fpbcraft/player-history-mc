# Web chat

Install both 0.8.12 JARs. The recorder hosts the chat API; the BlueMap mod supplies the browser controls. Public Minecraft chat and web messages appear in the chat panel. Chat events with a recorded player position appear as message bubbles on the map. Web messages sent while the player is offline appear in the chat feed without inventing a map position; they are not added to positional replay history. The chat feed keeps the latest 100 messages in memory and resets on server restart.

## One-time proxy setup

The recorder listens on `127.0.0.1:8101` by default. Route `/player-history-api/` on the same HTTPS hostname as the map to that listener. For nginx running on the Minecraft host, add this inside the map's existing HTTPS server block:

```nginx
location /player-history-api/ {
    proxy_pass http://127.0.0.1:8101;
    proxy_http_version 1.1;
    proxy_read_timeout 10s;
    client_max_body_size 4k;
}
```

Keep the path intact: the API expects the `/player-history-api/` prefix. If the proxy is on a different host or container, configure `webchat.bind` with the appropriate private interface and point the proxy to that address. Restrict access to the API listener to the proxy. No CORS configuration or IP matching is used. Do not expose the session file through the web server.

`config/playerhistory-common.toml`:

```toml
[webchat]
enabled = true
bind = "127.0.0.1"
port = 8101
```

Restart Minecraft after changing these settings. The API is unavailable when the recorder is disabled. The browser reports a configuration error if the reverse-proxy route is missing.

## Linking and using chat

1. Expand History and open the chat bubble button.
2. Click **Connect Minecraft account**.
3. Run the displayed `/webchat link CODE` command while logged into Minecraft. Only enter codes from your own browser.
4. The browser connects automatically; enter a message and press Send.

The pairing code expires after five minutes and can be used once. The browser's separate random secret becomes a 30-day session; the short code alone cannot send or poll an account session. Sessions survive server restarts and do not depend on IP addresses. Server-side session tokens are hashed and stored in `<world>/player-history/webchat-sessions.json`, outside the public dataset.

**Log out** revokes the current browser. `/webchat logout` in Minecraft revokes all browsers linked to that player. Minecraft must authenticate players correctly (normally `online-mode=true`, or a correctly secured authenticated proxy); linking inherits the server's player identity trust.

Messages are plain text, capped at 256 characters, rate-limited to one every two seconds per player, and prefixed `[Web]` in Minecraft. Banned and recorder-excluded accounts cannot send. Web messages use Minecraft system messages; they do not carry Mojang player-chat signatures or pass through third-party `ServerChatEvent` moderation hooks.

## Live trails

The live feed includes up to five minutes / 20,000 sampled movement points plus recent events. It publishes roughly every 250 ms; the browser polls once a second. It preserves sampler settings, discontinuity flags, historical batch cadence, and uses BlueMap's native live head. Recorded points and live points are deduplicated when joined. Very busy servers may exhaust the bounded live buffer before five minutes; older points still arrive through normal historical batches.
