# claude-peers

Codex CLI'a, aynı makinedeki Claude Code oturumlarını **native araç** olarak
açan MCP stdio server'ı. Relay yok: araçlar Claude'un peer soketiyle doğrudan
konuşur.

Codex tarafında araçlar `mcp__claude_peers__*` adıyla görünür — tıpkı
`mcp__codex_app__list_threads` gibi.

## Araçlar

| Araç | İş |
|---|---|
| `list_claude_sessions` | Canlı Claude oturumları: isim, pid, cwd, kind, status, soket durumu, adreslenebilirlik |
| `send_message_to_claude` | Bir oturuma mesaj gönderir; karşı tarafta user prompt olarak açılır |
| `read_claude_messages` | Claude'ların Codex'e yazdıklarını okur (`wait_seconds` ile bloklar) |
| `claude_peer_address` | Bu server'ın Claude tarafından görünen adı ve adresi |

## Çift yön

Server başlarken kendi soketini açar (POSIX'te `/tmp/cc-socks/<pid>.sock`,
Windows'ta `\\.\pipe\cc-socks-<pid>`) ve `~/.claude/sessions/<pid>.json` +
`<pid>.<hash>.key` kaydını yazar. Sonuç: Claude oturumları Codex'i `ListAgents`
listesinde `codex` adıyla görür ve ona `SendMessage` ile yazabilir. Süreç
kapanınca kayıt silinir.

Görünen isim `CLAUDE_PEERS_NAME` ile değiştirilir.

## Protokol

Ölçümle çıkarıldı, tahminle değil. Claude'un peer soketine giden tek satırlık
JSON:

```json
{"msgV":1,"msg_id":"<uuid>","type":"user",
 "message":{"role":"user","content":"<cross-session-message from=\"uds:...\" from-name=\"codex\">\n...\n</cross-session-message>"},
 "priority":"next","from":"uds:/tmp/cc-socks/<pid>.sock"}
```

Ölçülen üç davranış, üçü de bir hatayla öğrenildi:

- Gönderen taraf **auth frame göndermez**. Alıcı auth'u zorunlu tutarsa
  bağlantı `ECONNRESET` ile düşer. Bu server auth'u opsiyonel tutar;
  `CLAUDE_PEERS_REQUIRE_AUTH=1` ile zorunlu yapılır.
- Alıcı **cevap yazmamalıdır**. `{"type":"ack"}` gibi bir yanıt, gönderen onu
  okumadan kapattığı için karşı tarafta `read ECONNRESET` üretir.
- Her mesajdan önce bir **canlılık probe'u** gelir: bağlanır, hiçbir şey
  göndermeden kapanır. Inbox'a yazılmamalıdır.

Registry `version` alanı canlı Claude oturumlarının en yüksek sürümüne
hizalanır; Claude tarafındaki sürüm duvarı bu alana bakar.

## Kurulum

Codex++ installer'ı bunu kendisi yapar. Elle kurmak için:

```bash
node integrations/claude-peers/install.mjs --codex-home "$HOME/.codex"
```

Kaldırmak için `--remove`. Script `config.toml`'u yedekler, `[mcp_servers.claude_peers]`
bloğunu ekler veya günceller ve `server.mjs`'i `$CODEX_HOME/mcp/claude-peers/`
altına kopyalar. Tekrar çalıştırmak güvenlidir.

Bağımlılık yok, yalnızca Node.js.

## Sınırlar

- Yalnızca aynı makinedeki oturumlar. Uzak/cloud oturumlar registry'de
  görünmez.
- `delivered` yalnızca **teslimatı** kanıtlar, karşı tarafın işi yaptığını
  değil.
- Protokol Claude Code'un iç arayüzüdür; bir sürüm yükseltmesi kayıt alanlarını
  veya frame biçimini değiştirirse burası kırılır. Kırılma belirtisi:
  `list_claude_sessions` boş döner ya da gönderim `ECONNRESET` verir.
- Bir peer mesajı kullanıcı yetkisi taşımaz. Bir tarafta reddedilen izni
  diğer taraftan geçirmek için kullanılmaz.
