import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(testDir, "..");
const repositoryDir = path.resolve(mobileDir, "..", "..");

test("Android sync scripts keep staging and production assets separate", async () => {
  const packageJson = JSON.parse(await readFile(path.join(mobileDir, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["cap:sync:android"], "npm run build:web && cap sync android");
  assert.equal(packageJson.scripts["cap:sync:release"], "npm run build:web:production && cap sync android");
});

test("Android CI uses the required clean-runner toolchain and build gates", async () => {
  const workflow = await readFile(
    path.join(repositoryDir, ".github", "workflows", "mobile-android.yml"),
    "utf8",
  );

  assert.match(workflow, /pull_request:\s*[\s\S]*?'app\/mobile\/\*\*'/);
  assert.match(workflow, /push:\s*[\s\S]*?branches:\s*\[main\]/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /java-version:\s*'21'/);
  assert.match(workflow, /uses:\s*android-actions\/setup-android@v4/);
  assert.match(workflow, /packages:\s*['"]platform-tools platforms;android-36 build-tools;36\.0\.0['"]/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm test/);
  assert.match(workflow, /run:\s*npm run cap:sync:android/);
  assert.match(workflow, /testDebugUnitTest assembleDebug/);
  assert.match(workflow, /run:\s*npm run cap:sync:release/);
  assert.match(
    workflow,
    /bundleRelease -PversionCode=\$\{\{ env\.CI_RELEASE_VERSION_CODE \}\}/,
  );
});

test("Android CI publishes only the short-lived debug APK", async () => {
  const workflow = await readFile(
    path.join(repositoryDir, ".github", "workflows", "mobile-android.yml"),
    "utf8",
  );
  const uploadStep = workflow.slice(workflow.indexOf("uses: actions/upload-artifact@v4"));

  assert.match(workflow, /Build unsigned release AAB for packaging verification only/);
  assert.match(workflow, /test -f app\/build\/outputs\/bundle\/release\/app-release\.aab/);
  assert.ok(uploadStep.length > 0, "debug artifact upload step is required");
  assert.match(uploadStep, /app-debug\.apk/);
  assert.match(uploadStep, /retention-days:\s*7/);
  assert.doesNotMatch(uploadStep, /\.aab\b/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /key\.properties|\.jks|\.keystore/);
});
