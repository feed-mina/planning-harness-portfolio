-- Studio page content is now stored in D1; static page manifest/content files are deprecated.
CREATE TABLE IF NOT EXISTS studio_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_class TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS studio_page_fragments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_slug TEXT NOT NULL,
  fragment_order INTEGER NOT NULL,
  fragment_html TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (page_slug, fragment_order),
  FOREIGN KEY (page_slug) REFERENCES studio_pages (slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_studio_pages_is_active
  ON studio_pages (is_active);

CREATE INDEX IF NOT EXISTS idx_studio_page_fragments_slug_order
  ON studio_page_fragments (page_slug, is_active, fragment_order);

INSERT OR REPLACE INTO studio_pages (slug, title, body_class, is_active)
VALUES
  ('branding', 'Studio Branding', NULL, 1),
  ('native-build', 'Studio Native Build', NULL, 1),
  ('operations', 'Studio Operations', 'operations', 1),
  ('plans', 'Studio Plans', NULL, 1);

INSERT OR REPLACE INTO studio_page_fragments (page_slug, fragment_order, fragment_html)
VALUES
  ('branding', 0, '<header>
  <div class="logo">A</div>
  <div>
    <small>WHITE-LABEL CONFIGURATOR</small>
    <h1>Acme Knowledge Studio</h1>
    <p>Manage white-label studio presets and test branding configurations.</p>
  </div>
  <span class="saved">PRO entitlement</span>
</header>
<main>
  <section class="form">
    <div class="title"><h2>Branding Setup</h2><span>Edited</span></div>
    <label>App Name<input id="app-name" value="Acme Knowledge Studio"></label>
    <div class="row">
      <label>Primary color<input id="primary" value="#6d4aff"></label>
      <label>Custom domain<input id="domain" value="knowledge.acme.com"></label>
    </div>
    <label>Support URL<input value="https://support.acme.com"></label>
    <div class="row">
      <label>Update channel
        <select>
          <option selected>stable</option>
          <option>beta</option>
        </select>
      </label>
      <label>Signing strategy
        <select>
          <option>platform</option>
          <option selected>external</option>
        </select>
      </label>
    </div>
    <label>Preinstalled template packs
      <div class="packs"><span>garden-knowledge-base</span><span>kride-ai-chat</span></div>
    </label>
    <button type="button">Save Branding</button>
  </section>
  <section class="preview">
    <div class="title"><h2>Package preview</h2><span>Web + Desktop</span></div>
    <div class="app">
      <nav><b>A</b><strong>Acme Knowledge</strong><i>knowledge.acme.com</i></nav>
      <div class="appbody">
        <aside><span class="active">Overview</span><span>Knowledge</span><span>Templates</span><span>Team</span></aside>
        <article>
          <small>WELCOME BACK</small>
          <h3>Dashboard</h3>
          <p>Acme Garden + AI Chat integration is now ready.</p>
          <button type="button">Open preview</button>
          <div class="cards">
            <div><b>Garden</b><span>128 documents</span></div>
            <div><b>AI Chat</b><span>Ready</span></div>
          </div>
        </article>
      </div>
    </div>
    <pre>{
  "appName": "Acme Knowledge Studio",
  "domain": "knowledge.acme.com",
  "desktop": { "updateChannel": "stable", "signing": "external" },
  "preinstalledTemplates": ["garden-knowledge-base", "kride-ai-chat"]
}</pre>
  </section>
</main>'),
  ('native-build', 0, '<header>
  <div class="mark">S</div>
  <div>
    <small>SDUI DESKTOP STUDIO</small>
    <h1>Windows Native Build</h1>
    <p>Tauri executable smoke test gate</p>
  </div>
  <span class="pass">PASSED</span>
</header>
<main>
  <section class="summary">
    <div><span>Workflow</span><strong>Desktop Windows Native Smoke</strong></div>
    <div><span>Runner</span><strong>windows-latest</strong></div>
    <div><span>Duration</span><strong>10m 35s</strong></div>
    <div><span>Run</span><strong>#29149795817</strong></div>
  </section>
  <section class="pipeline">
    <h2>Native artifact pipeline</h2>
    <article class="done"><i>1</i><div><strong>Desktop CLI install</strong><p>npm ci + Tauri v2 CLI install</p></div><b>PASS</b></article>
    <article class="done"><i>2</i><div><strong>Tauri release compile</strong><p>x86_64 target release</p></div><b>PASS</b></article>
    <article class="done"><i>3</i><div><strong>Executable verification</strong><p>sdui-desktop-studio.exe smoke check</p></div><b>PASS</b></article>
    <article class="done"><i>4</i><div><strong>Artifact upload</strong><p>sdui-desktop-studio-windows-smoke</p></div><b>PASS</b></article>
  </section>
  <section class="artifact">
    <div class="file">EXE</div>
    <div><strong>sdui-desktop-studio-windows-smoke</strong><p>3,734,891 bytes (7 artifacts)</p></div>
    <span>Ready</span>
  </section>
</main>'),
  ('operations', 0, '<header>
  <div>
    <small>SDUI TEMPLATE KIT</small>
    <h1>Operations Audit</h1>
    <p>Role and policy snapshots are now available from Studio Operations API.</p>
  </div>
  <span class="role">ADMIN by mina</span>
</header>
<main>
  <section class="matrix">
    <div class="section-title">
      <div><h2>Current matrix</h2><p>Current role permissions and active policy flags.</p></div>
      <span>4 roles</span>
    </div>
    <table>
      <thead>
        <tr><th>Role</th><th>Read</th><th>Write</th><th>Delete</th><th>Publish</th><th>Export</th></tr>
      </thead>
      <tbody>
        <tr><td>Owner</td><td>O</td><td>O</td><td>O</td><td>O</td><td>O</td></tr>
        <tr class="active"><td>Admin</td><td>O</td><td>O</td><td>O</td><td>O</td><td>O</td></tr>
        <tr><td>Editor</td><td>O</td><td>O</td><td>-</td><td>-</td><td>-</td></tr>
        <tr><td>Viewer</td><td>O</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>
      </tbody>
    </table>
  </section>
  <section class="history">
    <div class="section-title">
      <div><h2>Recent history</h2><p>Example audit records for the current workspace.</p></div>
      <button type="button">Download JSON</button>
    </div>
    <article><span class="icon deploy">E</span><div><strong>Studio Policy</strong><p>/p/garden-demo/home/history/v2/</p></div><time>mina @ 2026-07-03</time></article>
    <article><span class="icon save">S</span><div><strong>Manifest v4</strong><p>Primary color update</p></div><time>editor-kim @ 2026-07-08</time></article>
    <article><span class="icon pack">P</span><div><strong>Package refresh</strong><p>Cloud package v3 release</p></div><time>editor-kim @ 2026-07-21</time></article>
    <article><span class="icon deploy">E</span><div><strong>Studio Policy</strong><p>/p/garden-demo/home/history/v1/</p></div><time>mina @ 2026-07-11</time></article>
  </section>
</main>'),
  ('plans', 0, '<header>
  <div>
    <small>SDUI TEMPLATE KIT</small>
    <h1>Plan & Usage</h1>
    <p>Live usage and feature availability by plan.</p>
  </div>
  <div class="current"><span>Current plan</span><strong>PRO</strong></div>
</header>
<main>
  <section class="usage">
    <div class="title"><div><h2>Usage</h2><p>garden-demo workspace</p></div><span class="healthy">Healthy</span></div>
    <div class="meters">
      <article><div><strong>AI usage</strong><b>348 / 1,000</b></div><progress value="348" max="1000"></progress><small>34.8%</small></article>
      <article><div><strong>Projects</strong><b>12 / 50</b></div><progress value="12" max="50"></progress><small>24%</small></article>
      <article><div><strong>Templates</strong><b>7 / 20</b></div><progress value="7" max="20"></progress><small>35%</small></article>
    </div>
  </section>
  <section class="plans">
    <div class="plan"><h3>Free</h3><p>Starter core</p><ul><li>1 project</li><li class="off">Managed deploy</li><li class="off">AI usage</li></ul></div>
    <div class="plan"><h3>Team</h3><p>Team collaboration</p><ul><li>10 projects</li><li>Package export</li><li>Managed deploy</li><li class="off">AI usage</li></ul></div>
    <div class="plan selected"><span class="badge">CURRENT</span><h3>Pro</h3><p>AI features + desktop access</p><ul><li>50 projects</li><li>AI 1,000 calls</li><li>White-label</li><li>Desktop activation</li></ul><button type="button">Change plan</button></div>
    <div class="plan"><h3>Enterprise</h3><p>Large scale + private support</p><ul><li>Unlimited projects</li><li>Priority Pro support</li><li>Custom compliance</li></ul></div>
  </section>
  <section class="lease">
    <span class="pulse"></span>
    <div><strong>Desktop activation status</strong><p>Device: win-studio-01 is heartbeat 3d, lease 12d</p></div>
    <button type="button">Revoke lease</button>
  </section>
</main>');
