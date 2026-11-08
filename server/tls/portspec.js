/* Смена порта панели: сборка параметров нового контейнера из описания старого (docker inspect).
   Чистые функции без обращения к Docker, их проверяют тесты. */

export const INNER_PORT = 8088;

const clone = x => JSON.parse(JSON.stringify(x ?? null));

/** Параметры createContainer для копии контейнера панели, у которой порт на хосте заменён на newPort. */
export function recreateSpec(c, newPort, inner = INNER_PORT) {
  const key = `${inner}/tcp`;
  const hc = clone(c.HostConfig) || {};
  hc.PortBindings = { ...(hc.PortBindings || {}) };
  const old = hc.PortBindings[key];
  hc.PortBindings[key] = (old?.length ? old : [{}]).map(b => ({ ...b, HostPort: String(newPort) }));
  const cfg = c.Config || {};
  const env = (cfg.Env || []).filter(e => !e.startsWith('PANEL_PORT=')).concat(`PANEL_PORT=${newPort}`);
  const nets = c.NetworkSettings?.Networks || {};
  const names = Object.keys(nets);
  const mode = hc.NetworkMode && hc.NetworkMode !== 'default' ? hc.NetworkMode : names[0];
  const endpoint = n => ({
    Aliases: (nets[n]?.Aliases || []).filter(a => !String(c.Id).startsWith(a)),
    ...(nets[n]?.IPAMConfig ? { IPAMConfig: nets[n].IPAMConfig } : {}),
  });
  const spec = {
    Image: cfg.Image, Env: env, Cmd: cfg.Cmd, Entrypoint: cfg.Entrypoint, WorkingDir: cfg.WorkingDir || undefined, User: cfg.User || undefined,
    Labels: clone(cfg.Labels) || {}, ExposedPorts: { ...(clone(cfg.ExposedPorts) || {}), [key]: {} },
    Tty: !!cfg.Tty, OpenStdin: !!cfg.OpenStdin, StopSignal: cfg.StopSignal || undefined, Healthcheck: clone(cfg.Healthcheck) || undefined,
    HostConfig: hc,
  };
  // Hostname и MAC не копируем: у нового контейнера они свои, по имени узла панель находит саму себя
  if (mode && nets[mode]) spec.NetworkingConfig = { EndpointsConfig: { [mode]: endpoint(mode) } };
  spec.extraNetworks = names.filter(n => n !== mode).map(n => ({ name: n, ...endpoint(n) }));
  return spec;
}

/** Строка файла .env с новым PANEL_PORT. */
export function envWithPort(text, port) {
  const t = String(text || '');
  if (/^PANEL_PORT=.*$/m.test(t)) return t.replace(/^PANEL_PORT=.*$/m, `PANEL_PORT=${port}`);
  return t + (t && !t.endsWith('\n') ? '\n' : '') + `PANEL_PORT=${port}\n`;
}

export const validPort = p => Number.isInteger(p) && p >= 1 && p <= 65535;
