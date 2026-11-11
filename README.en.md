<div align="center">

[![Русский: переключить язык](https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-%D1%87%D0%B8%D1%82%D0%B0%D1%82%D1%8C_%D0%BF%D0%BE--%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8-0969da?style=for-the-badge)](README.md)
[![English: you are here](https://img.shields.io/badge/English-you_are_here-2ea44f?style=for-the-badge)](README.en.md)

# 🧱 HorizonCraft

**A web panel for Minecraft servers, powered by Docker.**
Create, configure and maintain multiple servers from your browser. No Java, port or command-line wrestling.

[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/engine/install/)
[![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black)](#-requirements)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-orange)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-h0r1ze%2FHorizonCraft-181717?logo=github&logoColor=white)](https://github.com/h0r1ze/HorizonCraft)

[⭐ GitHub](https://github.com/h0r1ze/HorizonCraft) · [🐞 Report a bug](https://github.com/h0r1ze/HorizonCraft/issues/new) · [💡 Suggest an idea](https://github.com/h0r1ze/HorizonCraft/issues) · [🔀 Pull requests](https://github.com/h0r1ze/HorizonCraft/pulls)

<br>

<img src="docs/en/dashboard.png" alt="HorizonCraft panel: servers overview" width="860">

</div>

> [!NOTE]
> The panel interface is available in **Russian and English**. Switch the language in the side menu or in **Settings**; the choice is remembered in the browser. (Screenshots of newer features below are in English; some older ones still show the Russian interface.)

---

## ⚡ One-line install

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/install-en-dark.svg">
    <img src="docs/install-en-light.svg" alt="The HorizonCraft install command and its result: panel URL and password" width="860">
  </picture>
</p>

**Copy the command** (button on the right of the block) and run it on a Linux server:

```bash
curl -fsSL https://raw.githubusercontent.com/h0r1ze/HorizonCraft/main/install.sh | bash
```

The script checks for Docker (and offers to install it), downloads the project, creates a `.env` with a random admin password, then builds and starts the panel. When it finishes it prints the URL and the password, as in the picture above (the password is saved in `~/horizoncraft/.env`).

<details>
<summary><b>Manual install</b></summary>

```bash
git clone https://github.com/h0r1ze/HorizonCraft.git
cd HorizonCraft
cp .env.example .env
nano .env                  # set ADMIN_PASSWORD and an absolute DATA_DIR
mkdir -p "$(grep ^DATA_DIR= .env | cut -d= -f2)"
docker compose up -d --build
```
</details>

<details>
<summary><b>Installer options</b></summary>

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | random | Admin password (8+ chars, no spaces or `" ' $ # \ `` ` ``) |
| `PANEL_PORT` | `443` if free, otherwise `8443` | Web panel port. Without the variable the installer asks |
| `TLS_MODE` | `selfsigned` without a terminal, otherwise a question | `selfsigned`, `letsencrypt-domain`, `letsencrypt-ip`, `custom` or `off` |
| `TLS_HOST` | the machine's address | Domain or IP address of the panel; it goes into the certificate |
| `ACME_EMAIL` | unset | Email for Let's Encrypt (optional) |
| `TLS_CERT`, `TLS_KEY` | unset | Paths to your own certificate and key for the `custom` mode |
| `DATA_DIR` | `<project dir>/data` | Where servers, backups and settings live |
| `TZ` | system timezone | Time zone for schedules and logs |
| `HORIZONCRAFT_DIR` | `~/horizoncraft` | Clone target when installing via `curl` |
| `INSTALL_DOCKER` | unset | `1` installs Docker without asking |

The `--agent` flag turns on agent mode so the machine can be connected as a node, see [Multiple machines](#-multiple-machines-nodes).

Example: `PANEL_PORT=9090 ADMIN_PASSWORD=MySecret123 ./install.sh`
</details>

## ✨ Features

| | |
|---|---|
| 🚀 **Server creation** | Paper, Vanilla, Purpur, Fabric, Forge, NeoForge and one-click CurseForge modpacks. The Java version is picked automatically |
| 🖥️ **Console** | Live server log and command input right in the browser |
| 👥 **Players & chat** | Online list, kick, ban, private messages, whitelist, chat, coloured name prefixes/suffixes. A separate "Could not join" column: who was stopped by the whitelist, a ban or the licence check, with actions right from it |
| 🧩 **Mods** | Search and install from CurseForge and Modrinth |
| 💾 **Backups** | Manual and scheduled backups, retention limit, one-click restore |
| ⏰ **Schedules** | Restart (players are warned 30 seconds ahead), backup, or any command on a schedule |
| 🌍 **Multiple machines (nodes)** | Connect other computers and VPSes and create servers on them. Everything stays in one panel: console, files, backups and players work just like on the main machine |
| 🚚 **Move between machines** | Move a whole server (world, mods, settings) to another machine or node in one click, even a running one: the panel stops it and starts it at the new place |
| 🔄 **Updates** | New Minecraft versions and fresh versions of plugins and mods: files are recognised by hash on Modrinth and updated on selection, with a backup beforehand |
| 🗺️ **World map** | A live Dynmap map in one click: plugin, port and link are set up for you |
| 💬 **Discord** | A status board with the server status, players, version and address keeps itself up to date in your channel. Through a webhook or your own bot that the panel runs: it is online with a 'Playing …' status and writes only to the chosen channels. The message look, the name and the avatar are set from the panel with a preview. Optional notifications for starts, stops and player joins |
| 👥 **Player groups** | ADMIN, MODERATOR, VIP, FLY and HORIZON: ready-made permission sets and a coloured name tag. Groups can be renamed, permissions are set with checkboxes, and you can create your own groups in a couple of clicks. The permission plugins are installed with one button and a group is picked in the player form |
| 🧹 **World clearing** | The 'Clear the Overworld', 'Clear the Nether' and 'Clear the End' buttons: with a backup before deleting, and the server stops and starts again by itself |
| 🌐 **Two languages** | Russian and English interface, plus a separate language for Discord messages |
| 📋 **Templates** | Save a configured server (settings, mods, configs) as a template and create new servers from it on any machine |
| 🌐 **Network & domains** | Many servers behind a single port 25565 by domain (via `mc-router`), extra ports for voice chat or Dynmap |
| 📁 **Files** | Browse and edit files, upload, extract and download archives |
| 📦 **Import & clone** | Upload an existing server as an archive, or clone one together with its world |
| 📊 **Monitoring** | CPU, memory and disk usage for the host and each server |
| 🎨 **Looks** | Three interface layouts to choose from (Graphite, Light, Hosting) and 16 colour themes (eight dark and eight light, listed in separate groups), your own picture as the panel background, server covers and icons, coloured MOTD editor |
| 🛡️ **VLESS** | A node from a 3x-ui subscription (or a `vless://` link) is chosen once, then there is only a "direct / via VLESS" switch. Proxy mode for downloads or TUN for all server traffic |

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/en/server-overview.png" alt="Server overview"><br><sub><b>Server overview.</b> Players, CPU and memory over 30 minutes, quick actions</sub></td>
    <td width="50%"><img src="docs/en/console.png" alt="Console"><br><sub><b>Console.</b> Live log and command input</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/new-server.png" alt="Create a server"><br><sub><b>New server.</b> Paper, Vanilla, Purpur, Fabric, Forge, NeoForge and CurseForge packs</sub></td>
    <td width="50%"><img src="docs/en/mods.png" alt="Mods"><br><sub><b>Mods.</b> CurseForge search and Modrinth projects</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/network.png" alt="Network and domain"><br><sub><b>Network & domain.</b> Ports, domains via mc-router, server traffic direct or via VLESS</sub></td>
    <td width="50%"><img src="docs/en/files.png" alt="File manager"><br><sub><b>Files.</b> Browse, edit, upload and extract archives</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/nodes-dashboard.png" alt="Overview with nodes"><br><sub><b>Nodes on the overview.</b> Load of every machine and their servers in one list</sub></td>
    <td width="50%"><img src="docs/en/nodes-settings.png" alt="Nodes in settings"><br><sub><b>Settings → Nodes.</b> Status, connection check, image updates</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/nodes-form.png" alt="Connecting a node"><br><sub><b>Connecting a node.</b> Install command, address and token</sub></td>
    <td width="50%"><img src="docs/en/themes.png" alt="Themes"><br><sub><b>Themes.</b> Eight dark and eight light themes, split into groups</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/updates.png" alt="Updates"><br><sub><b>Updates.</b> New Minecraft versions and fresh plugin and mod builds</sub></td>
    <td width="50%"><img src="docs/en/migrate.png" alt="Moving a server"><br><sub><b>Moving a server.</b> To another machine or node, even a running one</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/map.png" alt="World map"><br><sub><b>World map.</b> Dynmap in one click</sub></td>
    <td width="50%"><img src="docs/en/template.png" alt="Create from a template"><br><sub><b>Templates.</b> A new server from a saved template</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/discord.png" alt="Discord bot"><br><sub><b>Discord.</b> Your own bot or a webhook, channels for the board and events, online status</sub></td>
    <td width="50%"><img src="docs/en/discord-look.png" alt="Discord message look"><br><sub><b>Message look.</b> Title, text, fields and footer with a channel preview</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/vless.png" alt="VLESS and proxy"><br><sub><b>VLESS.</b> The node and the mode (proxy or TUN) are chosen once</sub></td>
    <td width="50%"><img src="docs/en/attempts.png" alt="Could not join"><br><sub><b>Could not join.</b> Who was stopped by the whitelist, a ban or the licence check</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/groups.png" alt="Player groups"><br><sub><b>Player groups.</b> Standard and your own groups, what each one can do, the pencil opens the editor</sub></td>
    <td width="50%"><img src="docs/en/tags.png" alt="Group picker in the player form"><br><sub><b>Group and name tag.</b> Pick a group in the player form with a large in-game preview</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/worlds.png" alt="World clearing buttons"><br><sub><b>World clearing.</b> Three buttons in Quick actions, with the size of each dimension</sub></td>
    <td width="50%"><img src="docs/en/worlds-dialog.png" alt="Clearing confirmation"><br><sub><b>Confirmation.</b> A backup by default; the server stops and starts again automatically</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/en/language.png" alt="Language picker" width="620"><br><sub><b>Interface language.</b> Russian or English, switched in one click</sub></td>
  </tr>
</table>

> [!NOTE]
> Screenshots use demo data: addresses, covers and the console log text were replaced.

## 📋 Requirements

- **Linux.** Running on Ubuntu 26.04 with Docker 29. Other distributions and arm64 should work but are untested
- **Docker** with the **Docker Compose v2** plugin (the installer can set Docker up for you)
- **RAM:** a small margin for the panel itself plus typically 2–4 GB per Minecraft server, depending on the pack
- **Ports:** the panel port (`443` or `8443`, you choose at installation), server ports (`25565` and up by default) and port `80` while a Let's Encrypt certificate is being issued

> [!IMPORTANT]
> Windows and macOS are not supported: the panel drives Docker through `/var/run/docker.sock` and needs real host paths. On Windows, use WSL2 with Docker running inside Linux.

## 🔒 HTTPS and certificates

The panel controls Docker, so signing in must be encrypted. The panel enables HTTPS itself on the port you choose; no separate reverse proxy is needed. You choose at installation and can change it later in **Settings → Security**.

| Mode | When it fits | What you need |
|---|---|---|
| **Let's Encrypt for a domain** | The panel is reachable by a domain name | The domain's `A` record points to the server; port `80` is free and reachable from the internet |
| **Let's Encrypt for an IP address** | No domain, but a public IP | A public IPv4/IPv6; port `80` is free and reachable from the internet |
| **Self-signed** | Local network, home server | Nothing. The browser warns until the certificate is added to the trusted ones: ready-made installers are in the panel (see below) |
| **Custom certificate** | You have a certificate from your own CA | Certificate files (PEM, with the chain) and a key without a password |
| **HTTP** | Only while setting up | Not recommended: the password travels in plain text |

<table>
  <tr>
    <td width="50%"><img src="docs/en/tls-http.png" alt="Warning while running over HTTP"><br><sub><b>While HTTP is on.</b> A warning and the choice of how to get a certificate</sub></td>
    <td width="50%"><img src="docs/en/tls.png" alt="A Let's Encrypt certificate for an IP address"><br><sub><b>Let's Encrypt for an IP address.</b> The certificate, its lifetime, fingerprint, issuance progress and renewal</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/en/tls-trust.png" alt="Installing a self-signed certificate as trusted" width="560"><br><sub><b>Self-signed.</b> The "Remove the browser warning" block with installers for Windows, macOS, Linux and a phone</sub></td>
  </tr>
</table>

- **Removing the browser warning.** While a self-signed certificate is on, the HTTPS card has a block with ready-made installers that add the panel certificate to the trusted ones. **Windows:** run the downloaded `.bat` and click Yes in the confirmation window; administrator rights are not needed. **macOS:** run the `.command`, the system asks for your password. **Linux:** run the `.sh` (Chrome and Chromium through the NSS database, the system store through `sudo`). **Phone:** download the `.crt` file and install it as a CA certificate on Android or as a profile on iPhone (then turn on trust in "General → About → Certificate Trust Settings"). The installer contains only the public part of the certificate and its SHA-256 fingerprint; the private key is never handed out. Do this once on every device and again after "Create a new certificate". Firefox keeps certificates separately, so add it there by hand (Settings → Privacy & Security → Certificates → Import).
- **IP address certificates.** Let's Encrypt issues these for 160 hours (the `shortlived` profile). The panel renews them itself when about a third of the lifetime is left and checks every ten minutes. Let's Encrypt will not issue for local addresses (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`), so choose self-signed on a home network.
- **How validation works.** Let's Encrypt connects to your address on port `80`. The panel opens it for the duration of the check: it starts a temporary container from its own image and removes it right after issuing. It does not hold port `80` permanently. If the port is busy the panel says so and works with a temporary self-signed certificate until issuance succeeds.
- **Panel port.** It is chosen at installation (443 by default, 8443 if that is taken). You can change it later right in the panel: **Settings → Security → Panel port → Change port**. The panel recreates its own container with the new port within a few seconds (the Minecraft servers keep running), writes the port to `.env` and opens the new address. If the port is taken by another program or the panel does not come up, everything goes back to the old port and the reason is shown in the card. The command `./set-port.sh 8443` in the installation folder does the same. Do not forget to open the new port on the router and in the firewall. Ports below 1024 need no special rights.
- **One port for HTTP and HTTPS.** If you open the panel with `http://` on a port with encryption enabled, the browser is redirected to `https://` automatically.
- **If the page stops opening.** `./disable-https.sh` switches back to plain HTTP so you can set HTTPS up again.
- **Cookies and headers.** Over HTTPS the sign-in cookie gets the `Secure` flag. HSTS is enabled for trusted Let's Encrypt certificates. It is not enabled for self-signed ones, so the browser does not lock you out.
- **Storage.** The certificate and key live in `$DATA_DIR/tls/` with mode `600` and never enter `panel.json`.
- **Nodes over HTTPS.** A node installed with encryption is connected by an address like `https://IP:8443`. If its certificate is self-signed, the main panel shows the SHA-256 fingerprint and asks you to confirm it. The fingerprint is pinned: if the node issues a different certificate, the panel stops trusting it until you confirm the new one.
- **Your own certificate authority.** The `ACME_DIRECTORY` variable lets you point at the ACME directory of an internal CA (for example step-ca); local IP addresses are then allowed too.

## 🌍 Multiple machines (nodes)

One panel can manage Minecraft servers on several computers: a home server, a NAS, a rented VPS. A node is a regular HorizonCraft install running in **agent mode**. The main panel connects to it with an address and a token and shows its servers next to its own.

**1. On the second machine** (Linux, only Docker is required):

```bash
curl -fsSL https://raw.githubusercontent.com/h0r1ze/HorizonCraft/main/install.sh | bash -s -- --agent
```

At the end the script prints the node's **address** and **token**.

**2. In the main panel:** **Settings → Servers and nodes → Nodes → Connect a node**, paste the address and token. The panel checks the connection and immediately lists the node's servers.

**3. Create a server on the node:** the **New server** page gets a machine picker. Uploading an existing server archive also works for any node.

<details>
<summary><b>What works on a node and what doesn't</b></summary>

Requests for servers on a node are forwarded to its agent, so everything local servers have works there: console, players, files, backups, schedules, mods, domains, import and cloning (the copy is created on the same node).

- The CurseForge key set in the main panel is passed to nodes automatically.
- **VLESS proxy and "Minecraft images"** are configured per node: the proxy in its own panel, images with the **Images** button in the node list.
- Servers can be moved between machines, see [Moving a server](#-moving-a-server-between-machines).
- If a node is unreachable, its servers stay in the list marked "Node unreachable". The servers themselves keep running on their machine.
- Players connect to the node directly; game traffic does not go through the main panel. For a domain, set **Address for players** in the node form.
- Removing a node from the panel does **not** delete its servers: they keep running and the node can be connected again.
</details>

> [!WARNING]
> A node token gives full control over Docker on that machine. Open the node's port in the firewall **only for the main panel's IP** (`sudo ufw allow from <IP> to any port 8088 proto tcp`). Traffic between panels is plain HTTP, so over the internet connect nodes through a VPN (WireGuard, Tailscale) or put a reverse proxy with HTTPS in front of the agent and use an `https://…` address.

## 🖼️ Interface layouts

**Settings → Appearance → Interface layout** switches the page layout. Colours come from the theme, so layout and theme can be combined freely. The choice is remembered in the browser.

<table>
  <tr>
    <td width="33%"><img src="docs/en/ui-a.png" alt="Layout A: Graphite"><br><sub><b>A · Graphite.</b> Narrow icon rail, servers as rows, grouped server tabs with rare ones under "More"</sub></td>
    <td width="33%"><img src="docs/en/ui-b.png" alt="Layout B: Light"><br><sub><b>B · Light.</b> Large server cards and room to breathe. Server sections in a vertical three-group menu</sub></td>
    <td width="33%"><img src="docs/en/ui-c.png" alt="Layout C: Hosting"><br><sub><b>C · Hosting.</b> Top navigation, servers as a table, ring gauges for host resources</sub></td>
  </tr>
  <tr>
    <td><img src="docs/en/ui-a-server.png" alt="Server page, layout A"></td>
    <td><img src="docs/en/ui-b-server.png" alt="Server page, layout B"></td>
    <td><img src="docs/en/ui-c-server.png" alt="Server page, layout C"></td>
  </tr>
</table>

On a phone the side and top menus are replaced by a bottom bar, and server sections become a scrollable strip. Cards, player buttons and dialogs fit the screen width, with no horizontal scrolling.

<p align="center"><img src="docs/en/mobile.png" alt="The panel on a phone" width="900"></p>

The bottom of every page and the sign-in screen show the copyright «© 2026 h0r1ze», the panel version and GitHub links: the [repository](https://github.com/h0r1ze/HorizonCraft), [report a bug](https://github.com/h0r1ze/HorizonCraft/issues/new) and the license. The left menu has a **GitHub** button that opens the source code.

## 🎨 Themes and panel background

**Settings → Appearance → Theme** offers 16 themes, eight dark and eight light. You can also switch the theme and the **interface layout** (Graphite, Light, Hosting) quickly from the menu on the left, no need to open Settings.

<p align="center"><img src="docs/en/ui-menu.png" alt="Quick interface layout switch in the left menu" width="360"></p>

- **Dark:** Dark, Neon, Blue, Sunset, Ocean, Graphite, Ayanami Rei (night), Burgundy.
- **Light:** Light, Pink, Soft beige, Ayanami Rei, Mint, Sky, Lavender, Amber.
- **Your last choice is remembered.** The theme is stored on the server and in the browser: signing in from another computer or a phone shows the same look.

**Settings → Appearance → Panel background**: each of the 16 themes (dark and light alike) can have its own picture behind the interface. The background changes together with the theme.

<table>
  <tr>
    <td width="50%"><img src="docs/en/background.png" alt="Binding pictures to themes"><br><sub><b>Pictures and themes.</b> A theme tile shows its picture and an "auto" or "own" tag</sub></td>
    <td width="50%"><img src="docs/en/background-overview.png" alt="Dark theme with a picture"><br><sub><b>Dark theme with a picture.</b> The cards are slightly transparent and the text stays readable</sub></td>
  </tr>
</table>

- **Auto-pick.** Until you choose anything, the panel picks a picture for every theme by colour: a theme accent has a hue, a picture has dominant colours and a brightness. Dark themes get darker pictures, light themes lighter ones, and files with "Rei", "Ayanami" in the name lean towards the Ayanami Rei themes. One picture is avoided for all themes at once where possible. Auto-pick can be switched off with the toggle in the card.
- **Your own picture for a theme.** Click a theme tile, then a picture from the list: the tile gets an "own" tag. **No background** is remembered for a theme too. **Auto for this theme** gives one theme back to auto-pick, **Auto for all themes** clears all your choices, **Apply to all themes** puts one picture (with its dimming and blur) on all 16 themes.
- **New pictures.** Click **Upload** or drag a file right into the card: it is bound at once to the theme selected in the card (the current one by default), and auto-pick may offer the new picture to other themes. JPEG, PNG, WebP, GIF and AVIF up to 16 MB are accepted.
- The panel shrinks the picture to 2560×1440, stores it as WebP on the server and shows the background on every device. Up to 12 pictures can be kept; delete extra ones with the bin button on a thumbnail, and the themes that used it go back to auto-pick.
- **Dimming** (0–90%) tints the picture with the colour of the theme, so light themes stay light and dark ones stay dark (auto-picked light themes use 55%, dark ones 35%). **Blur** (0–24 px) hides distracting detail. Both values are remembered per theme.
- A background you set before this update becomes the picture of the theme that was selected.
- The pictures are only available after signing in; the sign-in page shows no background.

## 🚚 Moving a server between machines

Server page **"⋯" menu → Move to another machine** (shown once at least one node is connected). You can move from the main machine to a node, from a node to the main machine, and between nodes.

1. Choose the destination. If the server is running, the panel stops it (the world is saved) and, if you wish, starts it at the new place.
2. Server files are streamed as `tar.gz` from one machine to the other through the main panel, with no temporary files on its disk.
3. The new machine gets a server with the same settings: type and version, memory, properties, mod lists, schedule, player tags, cover and icon, world map.

Until the move succeeds the source server stays untouched. On an error at any step it is started again and the data received on the new machine is discarded. By default the source server **stays** (stopped) on the old machine: delete it once you are sure everything works, or turn on "Delete after a successful move".

<details>
<summary><b>What is not moved</b></summary>

- **The domain.** It is configured per machine: set it up again on the "Network & domain" tab.
- **The VLESS node.** It is chosen in each machine's panel. The server's "Via VLESS" switch is moved along.
- **The port** is kept if free on the new machine, otherwise the next free one is used.
- Servers containing symbolic links are not moved (such archives are rejected for safety).
</details>

## 🔄 Updates

The **Updates** tab on a server page:

- **Core.** If the server is pinned to a Minecraft version and newer ones exist, the panel says so and offers to update. A backup can be created before the version change. For a "latest" server a restart is enough.
- **Plugins and mods.** Files in `plugins/` (Paper, Purpur) or `mods/` (Fabric, Forge, NeoForge) are matched against [Modrinth](https://modrinth.com) by hash, so it does not matter where they came from. Pick the updates and press **Update selected**: the file is downloaded, verified by checksum and replaces the old one.
- For a pinned server it shows how many of your plugins and mods already have builds for the newest Minecraft version.
- Every 6 hours the panel checks servers by itself and puts a badge with the number of available updates on the server card.

Files that are not on Modrinth (built by hand or taken from other sites) are listed separately and are not updated automatically.

## 🗺️ World map

The **Map** tab (Paper and Purpur servers) enables [Dynmap](https://modrinth.com/plugin/dynmap) in one click: the panel adds the plugin to the Modrinth auto-install list, picks a free port for the map page (from 8123–8199) and shows a link and a preview. The plugin is downloaded on the next server start. **Render** starts a full render of the world. To share the map with friends, forward the shown port on your router.

## 🔀 VLESS: proxy and TUN

If installer sites, CurseForge, Mojang or Discord are blocked where you live, the panel sends traffic through your VLESS server. The node and the mode are chosen **once** in **Settings → Network → VLESS and proxy**. After that there is only a **Direct / Via VLESS** switch everywhere: on the server page (**Network & domain → Server traffic**), for the panel's CurseForge requests and in the Discord tab.

<p align="center"><img src="docs/en/vless.png" alt="VLESS and proxy in the settings" width="760"></p>

1. Load a 3x-ui subscription (or paste its content), add a separate `vless://` link or enter your own proxy.
2. Mark the node the traffic goes through, for example `RIGA-BOT`. The **Check** button on each node shows whether it responds.
3. Choose the mode:
   - **Proxy.** Core installation and mod and modpack downloads go through the node: the programs get a proxy address. The server itself works direct.
   - **TUN.** **All** outgoing server traffic goes through the node: downloads, Mojang licence checks, mod and plugin requests. Nothing has to be configured in the programs. An xray runs next to the server, and the server's outgoing TCP connections are transparently redirected into it. UDP (for example DNS) goes direct.
4. On the server page turn on **Via VLESS** and save. The switch applies on the next server start; changing the node or the mode takes effect at once, no restart needed.

- Player connections to the server always go direct, so in-game latency does not change.
- In TUN mode the server page shows whether the interception works. If it did not start (no nftables or iptables in the kernel), the server keeps working direct and the reason is shown there.
- If the node disappears from the subscription, the active node is cleared, while the **Via VLESS** switches stay and work again once you pick a node.
- If a node link asks for a random TLS fingerprint (`fp=random`), the panel uses `chrome`: REALITY servers reject some random variants, and the node would work only now and then.
- For servers on nodes, the node and the mode are chosen in the panel of the machine that runs the server.

## 💬 Discord status board and bot

The **Discord** tab (under "System") turns a single message in your channel into a live status board: online or offline, player count and names, version, address, uptime and memory. Choose the sender: a channel **webhook** (no bot needed) or **your own bot**, which the panel runs itself.

<table>
  <tr>
    <td width="50%"><img src="docs/en/discord-setup.png" alt="Connecting Discord"><br><sub><b>Connecting.</b> A webhook or your own bot, with a hint where to get the token</sub></td>
    <td width="50%"><img src="docs/en/discord.png" alt="Discord bot"><br><sub><b>The bot is running.</b> Channels for the board and events, online status, refresh rate</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/en/discord-look.png" alt="Message look"><br><sub><b>Message look.</b> Title, text, fields and footer, the channel preview updates at once</sub></td>
    <td width="50%"><img src="docs/en/discord-bot.png" alt="Bot profile"><br><sub><b>How the bot looks.</b> Name, avatar, "About me" and status right from the panel</sub></td>
  </tr>
</table>

**Webhook** (the simplest way):

1. In Discord open the channel: **Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**.
2. In the panel open the server → **Discord** → **Webhook**, paste the URL and click **Connect**.

**Your own bot:**

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), click **New Application**, then in **Bot** click **Reset Token** and copy the token.
2. In the panel open the server → **Discord** → **Your own bot**, paste the token and click **Connect the bot**.
3. Click **Invite the bot to a Discord server**: an invite with the required permissions opens (view channel, send messages, embed links, read history).
4. Choose the Discord server, the **status board channel** and, if you like, a separate **events channel**, then **Start the bot**. The bot writes only to the chosen channels and stays silent in the others, even if it can see them.

The bot stays online and shows a status under its name, for example **Playing Survival: 3/20**. The status type (playing, watching, listening, competing, custom text) and the text with the `{server}`, `{online}`, `{max}`, `{address}`, `{version}` placeholders are set in the **How the bot looks** card. The dot is green while the server runs, yellow while it starts and red when it is off. The same card changes the bot's **name, avatar and "About me"**: the preview on the right shows the profile as Discord will. For a webhook, the sender name and avatar are changed the same way.

The **How the message looks** card sets the title, the text under it (Discord formatting works), which fields to show and the footer. The channel preview on the right updates at once, and after saving the board in the channel looks the same.

The panel edits the same message instead of flooding the channel. It refreshes every 30 seconds, 1, 2 or 5 minutes, and a start, a stop or a change in player count reaches the board almost immediately. Optionally, separate messages announce events, each with its own switch: 'server started' (off by default), 'stopped', 'crashed', 'player joined or left'. The same server-state event arrives at most once every 10 minutes. **Send again** deletes the old message and posts a fresh one (for example, to pin it). When the channel changes, the old board is deleted.

- The webhook URL and the bot token are secrets: the panel never shows them in the interface and leaves them out of clones, migrations and templates. `@everyone` mentions in messages are disabled.
- Discord is blocked by some providers. The **Connection to Discord** block switches the board requests and the bot connection to **Via VLESS** (the node from the [VLESS settings](#-vless-proxy-and-tun)). The rest of the traffic is unchanged. **Check connection** shows at once whether Discord opens and accepts the webhook or the token.
- If the panel stops, the message stops updating (the timestamp in it shows this) and the bot goes offline.

## 👥 Player groups

The **Players → Player groups** block gives you five standard groups that you can edit, delete and extend with your own. Permissions come from [LuckPerms](https://modrinth.com/plugin/luckperms); the `/fly` and `/tpa` commands come from [EssentialsX](https://modrinth.com/plugin/essentialsx). The panel downloads both plugins from Modrinth, creates the groups and assigns them to players.

| Group | Name tag | What it can do |
|---|---|---|
| **ADMIN** | red `[ADMIN]` | Full access: all server and plugin commands |
| **MODERATOR** | blue `[MODERATOR]` | Kick, ban (including temporary), mute, teleport to players and players to you, vanish, inventory viewing, flight. Not allowed: giving items, changing game mode, OP, stopping the server |
| **VIP** | yellow `[VIP]` | Flight and teleport |
| **FLY** | green `[FLY]` | Flight only |
| **HORIZON** | grey `[HORIZON]` | A regular player with no privileges, teleport. Players with no group assigned get the same permissions |

1. Open the server → **Players** → **Player groups**. If the server runs Vanilla, click **Switch to Paper**: the world, settings and players are kept.
2. Click **Enable groups** and restart the server. Permissions are applied by themselves after it starts.
3. In the **Name tags** form enter a nickname and pick a group. The group's name tag is filled in automatically. You can assign a player in advance: the group is applied when they join.

- Teleport for VIP and HORIZON works by request: `/tpa`, `/tpahere` and `/tpaccept` by the other player (FLY has no teleport). A direct `/tp` is only available to ADMIN and MODERATOR.
- **Chat without brackets.** The `<` `>` brackets are part of Minecraft's standard chat format. The **Chat without brackets** switch in the groups card installs the EssentialsX chat module and Vault and passes the players' name tags into LuckPerms; the format becomes `[ADMIN] Nick: message`. The tag colour is kept. The colour of the nickname itself, picked in the name tag form, shows in chat too: the panel turns off EssentialsX's red operator colour (`ops-name-color`) and resets the tag's bold before the nickname. A server restart is needed after enabling. The panel's Chat tab understands both formats.
- **LuckPerms notifications.** Admins see lines marked `[LP] LOG` in the in-game chat whenever permissions change, including when the panel itself changes a group. The **Hide LuckPerms notifications in the in-game chat** switch turns them off (the `log-notify` option in the LuckPerms config) without a server restart.
- Permissions are bound to the player's UUID, so changing the nickname's letter case or assigning again duplicates nothing.
- EssentialsX officially supports Minecraft versions with a small delay. On the very newest versions the log may show an "unsupported server version" warning; the plugin still loads.

### Your own groups and permissions

The pencil on a group card opens the editor. Built-in groups can be edited, and new ones are created with **New group** (up to 20 groups).

<p align="center"><img src="docs/en/groups-editor.png" alt="Group editor" width="640"></p>

- **Name, tag, description and priority.** The tag uses the same colours and styles as the nickname tags, with a preview below. A priority from 1 to 999 decides whose permissions win when a player has several groups.
- **Permissions as checkboxes.** The catalogue is arranged by topic: movement, teleport, moderation, gameplay, chat, administration. Any other plugin permission (`worldedit.*` and the like) is added by hand in the **Other permissions** block.
- **Live in the game.** If the server is running, changes go to LuckPerms at once; otherwise they apply on the next start.
- **Reset and delete.** A built-in group can be returned to its default with **Reset to default**. Any group can be deleted, standard ones included: its players get the standard permissions. Deleted standard groups come back with the **Restore the standard groups** button in the card. The HORIZON group's permissions also define the permissions of players with no group, so without it they have no special permissions.
- **Only what is granted.** The group cards list only the permissions the group has.

### If the plugins do not start

The Minecraft server does not run as root, so the `plugins` folder must belong to its user. If an earlier panel version created it, the plugins get disabled with an `AccessDeniedException`, and commands like `list` and `weather` answer "unexpected error". The panel fixes the permissions by itself when you open the **Players** tab and suggests restarting the server. On Paper and Purpur it also runs vanilla commands (`list`, `kick`, `ban`, `tell`, `gamemode`, `weather`, `time` and others) with the `minecraft:` prefix so plugins cannot intercept them.

## 🚪 Could not join

The **Players** tab has a **Could not join** column next to the online list: players stopped by the whitelist or a ban, who failed the licence check, came with a different version or left while joining. Each entry shows the reason, the number of attempts, when the last one was and the address it came from.

<p align="center"><img src="docs/en/attempts.png" alt="The Could not join column" width="900"></p>

While a player is offline, you can act right from the column: **Add to the whitelist**, **Ban** or **Unban**, **Name tag** (the nick goes into the name tag form, and the tag and the group apply on the first join). The cross hides the player from the list; new attempts appear again.

- The list comes from the server logs for the last 30 days, so it is available even while the server is off. The whitelist and bans change through RCON, so the server has to be running for them.
- A player disappears from the column after a successful join.
- The **Players** tab follows the order of working with a nick: "Online" and "Could not join" at the top, then "Add by nick", the whitelist, operators and bans, then "Name tags", and the group setup at the end.
- On a server without licences (`online-mode=false`), Minecraft whitelists and bans the licensed UUID of the nick, while the player joins with a different UUID. This is how the game works: on such servers it is easier to turn the whitelist off for a while.

## 🧹 World clearing

On the server overview, **Quick actions** has the **Clear the Overworld**, **Clear the Nether** and **Clear the End** buttons. Only the chunk data of the chosen dimension is deleted: inventories, achievements, settings and the other dimensions are untouched. The server generates the dimension anew on the next start.

- A backup is made before clearing by default (you can turn it off in the confirmation window).
- If the server is running, the panel stops it and starts it again after clearing.
- The Overworld has a **new seed** option: `level.dat` is deleted, so the world is created with a different seed, and time, weather and game rules are reset.
- Both folder layouts are supported: the new one (`world/dimensions/minecraft/…`) and the older one (`world/region`, `DIM-1`, `DIM1`, `world_nether`, `world_the_end`).

## 🌐 Interface language

The panel speaks Russian and English. Switch it with the button in the side menu or in **Settings → Appearance → Language**. The browser language is used by default. The language of Discord messages is chosen separately on the **Discord** tab.

## 📋 Server templates

**"⋯" menu on a server page → Save as template.** A template holds the type and version, memory, `server.properties` values, Modrinth and CurseForge mod lists, the schedule and, optionally, the `mods`, `plugins` and `config` folders. The world, player tags and domain are not saved. On **New server** pick a template, give it a name, and the server appears on the chosen machine (including a node) already with the right plugins. Templates are managed under **Settings → Servers and nodes → Server templates**.

## 🔧 Configuration

The panel's **Settings** page has four sections with a section menu on the left (tabs at the top in the Graphite layout):

| Section | What is there |
|---|---|
| **Appearance** | Language, interface layout, theme and panel background |
| **Network** | The default public server address, [VLESS: node and mode](#-vless-proxy-and-tun) |
| **Security** | [HTTPS and certificates](#-https-and-certificates), the panel port, certificate trust, password change |
| **Servers and nodes** | The CurseForge key (and the panel's requests to it via VLESS), Minecraft images, server templates, nodes |

<p align="center"><img src="docs/en/settings.png" alt="The Network section of the settings" width="900"></p>

Each section has its own address (`#/settings/network` and so on), so links like "change in Settings" open the right place at once.

Installation settings live in `.env` next to `docker-compose.yml`. Apply changes with `docker compose up -d`.

| Setting | Description |
|---|---|
| `ADMIN_PASSWORD` | Admin password. **Used only on first start.** Change it later in the panel (Settings → Security → Change password) |
| `DATA_DIR` | Absolute path to data. Don't change it after creating servers without moving the folder |
| `PANEL_PORT` | Host port of the web panel |
| `TZ` | Time zone of the panel and servers |
| `AGENT_TOKEN` | Optional. If set (24+ characters), this panel can be connected as a node. Created by `./install.sh --agent` |

To search and install CurseForge modpacks, get a free API key at [console.curseforge.com](https://console.curseforge.com/) and paste it under **Settings → Servers and nodes → CurseForge**.

## 🔄 Maintenance

| Task | Command |
|---|---|
| Update the panel | `./update.sh` |
| Forgot the password | `./reset-password.sh` (or `./reset-password.sh NewPassword`) |
| View panel logs | `docker compose logs -f panel` |
| Stop the panel | `docker compose stop panel` |
| Back up everything | copy the `DATA_DIR` folder (ideally with servers stopped) |

> [!TIP]
> Updating or restarting the panel does **not** stop your Minecraft servers: they run in separate containers.

<details>
<summary><b>Uninstall</b></summary>

1. Delete (or stop) all servers in the panel.
2. Remove the panel: `docker compose down --rmi all`
3. Optionally delete the data: `rm -rf <DATA_DIR>` (**this permanently deletes worlds and backups**).
4. Leftover helper containers, if any: `docker rm -f mcpanel-router mcpanel-xray mcpanel-proxy-relay`, TUN sidecars `docker rm -f $(docker ps -aq -f name=mcpanel-tun-)` and `docker network rm mcpanel`.
</details>

## 🛠️ How it works

```text
        browser
           │  https://host:port
           ▼
 ┌────────────────────┐       docker.sock       ┌──────────────────────────────┐
 │  horizoncraft      │ ──────────────────────► │ Docker Engine                │
 │  (Node.js, Preact) │                         │  ├─ mc-xxxxxxxx  (Paper …)   │
 └────────────────────┘                         │  ├─ mc-yyyyyyyy  (Forge …)   │
           │                                    │  ├─ mcpanel-router (domains) │
           ▼                                    │  └─ mcpanel-xray  (proxy)    │
   $DATA_DIR/                                   └──────────────────────────────┘
   ├─ panel.json   settings and server list
   ├─ servers/     worlds and server files
   └─ backups/     backups
```

- Every Minecraft server is a separate [`itzg/minecraft-server`](https://github.com/itzg/docker-minecraft-server) container created and configured by the panel.
- Commands and the player list go through RCON (a unique password is generated per server).
- VLESS: the `mcpanel-xray` container provides a fixed entry for the active node, and in TUN mode each server "via VLESS" gets a `mcpanel-tun-…` sidecar in the server's network namespace.
- Backend: Express, `dockerode`, WebSocket. Frontend: Preact + htm with no build step, just plain files in `public/`.

## 🔐 Security

> [!WARNING]
> Access to the panel equals access to Docker on the host, which is effectively root. Treat it accordingly.

- The panel encrypts the connection itself: a self-signed certificate by default, and for the internet choose Let's Encrypt (domain or IP address), see [HTTPS and certificates](#-https-and-certificates). Keep the "HTTP" mode only while setting up. If the panel port is open to the internet, additionally restrict it with a firewall or a VPN.
- Use a long, unique password and change the installer-generated one after first login.
- `.env` holds the password: it is created with `600` permissions and listed in `.gitignore`. Never publish it.
- Login attempts are rate-limited; sessions last 7 days in an `httpOnly` cookie.

## ❓ FAQ

<details>
<summary><b>The panel page doesn't open</b></summary>

```bash
docker compose ps
docker compose logs --tail 50 panel
```
Make sure `PANEL_PORT` isn't blocked by a firewall.
</details>

<details>
<summary><b>Players can't join from the internet</b></summary>

You need three things: the server port open in the firewall, forwarded on your router to the panel machine, and a public (non-CGNAT) IP from your ISP. Behind CGNAT use a VPN or a tunnel.
</details>

<details>
<summary><b>Port 25565 is taken</b></summary>

It is reserved for `mc-router` as soon as any server has a domain set. Give the other servers a different port on the **Network & domain** tab.
</details>

<details>
<summary><b>Modpacks or mods do not download</b></summary>

If CurseForge, Modrinth or Mojang are unavailable from your provider, pick a node in **Settings → Network → VLESS and proxy** (a 3x-ui subscription or a `vless://` link) and turn on **Via VLESS** on the server page. More: [VLESS: proxy and TUN](#-vless-proxy-and-tun).
</details>

## 🤝 Contributing

Issues and pull requests are welcome: [ask a question or report a bug](https://github.com/h0r1ze/HorizonCraft/issues/new), [open a pull request](https://github.com/h0r1ze/HorizonCraft/pulls). If the panel is useful to you, please star it ⭐ on [GitHub](https://github.com/h0r1ze/HorizonCraft). By sending a pull request you agree that your contribution is distributed under the same terms as the rest of the project (see the [license](LICENSE)). To run from source you need Node.js 22 and a working Docker:

```bash
npm install
DATA_DIR="$PWD/data" ADMIN_PASSWORD=devpassword node server/index.js
```

## 📄 License

License: [PolyForm Noncommercial 1.0.0](LICENSE). Author and copyright holder: © 2026 [h0r1ze](https://github.com/h0r1ze). Source code: [github.com/h0r1ze/HorizonCraft](https://github.com/h0r1ze/HorizonCraft).

- **Free to:** use the panel for yourself, friends and your community, study the code, change it for your needs and share it for noncommercial purposes.
- **Not allowed without the author's written permission:** selling the panel or copies of it, offering it as a paid service, bundling it into commercial products or using it for commercial purposes.
- **Required:** whenever you pass the code on, modified or not, keep the [LICENSE](LICENSE) file with the line `Required Notice: Copyright 2026 h0r1ze`. That keeps the credit with the author.
- **Commercial license:** for commercial use, contact the author on [GitHub](https://github.com/h0r1ze).

This is a short summary; only the text in the [LICENSE](LICENSE) file is legally binding.

---

<div align="center">

[![Русский: переключить язык](https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-%D1%87%D0%B8%D1%82%D0%B0%D1%82%D1%8C_%D0%BF%D0%BE--%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8-0969da?style=for-the-badge)](README.md)
[![English: you are here](https://img.shields.io/badge/English-you_are_here-2ea44f?style=for-the-badge)](README.en.md)


© 2026 [h0r1ze](https://github.com/h0r1ze) · [GitHub](https://github.com/h0r1ze/HorizonCraft) · [Issues](https://github.com/h0r1ze/HorizonCraft/issues) · [PolyForm Noncommercial](LICENSE)

</div>
