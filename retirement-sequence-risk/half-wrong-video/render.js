#!/usr/bin/env node
// Draw every frame of scene.html in headless Chrome and encode the video.
//
//   node render.js --work DIR                 full render: frames → DIR/video.mp4 (no audio), in parallel segments
//   node render.js --stills 5,42.5 --out DIR  write single frames as PNGs (for checking)
//   node render.js --poster poster.png        the poster frame
//
// Needs puppeteer-core (NODE_PATH or a local node_modules) and Google Chrome. Frames are piped straight into
// ffmpeg, so nothing is written to disk but the encoded segments.
"use strict";
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");
const HERE = __dirname;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
const facts = JSON.parse(fs.readFileSync(path.join(HERE, "facts.json"), "utf8"));
const timing = JSON.parse(fs.readFileSync(path.join(HERE, "timing.json"), "utf8"));
const FPS = timing.fps || 30;

async function openPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto("file://" + path.join(HERE, "scene.html"), { waitUntil: "networkidle0" });
  const ok = await page.evaluate(async (f, t) => { setup(f, t); return fontsReady(); }, facts, timing);
  if (!ok) throw new Error("fonts did not load (scene.html pulls Bricolage Grotesque and Public Sans from Google Fonts)");
  return page;
}
const shot = (page) => page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 }, optimizeForSpeed: true });

const launch = () => puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--force-device-scale-factor=1", "--hide-scrollbars", "--disable-lcd-text"] });

async function main() {
  const browser = await launch();
  try {
    if (opt("poster")) {
      const page = await openPage(browser);
      await page.evaluate(() => drawPoster());
      fs.writeFileSync(opt("poster"), await shot(page));
      return;
    }
    if (opt("stills")) {
      const out = opt("out", "."), page = await openPage(browser);
      fs.mkdirSync(out, { recursive: true });
      for (const s of opt("stills").split(",")) {
        const t = parseFloat(s);
        await page.evaluate((t) => draw(t), t);
        fs.writeFileSync(path.join(out, `t${t.toFixed(2).padStart(7, "0")}.png`), await shot(page));
      }
      return;
    }
    const work = opt("work");
    if (!work) throw new Error("--work DIR required");
    fs.mkdirSync(work, { recursive: true });
    const total = Math.round(timing.duration * FPS), N = parseInt(opt("workers", "6"), 10), per = Math.ceil(total / N);
    const t0 = Date.now();
    let done = 0;
    const seg = async (k) => {
      const a = k * per, b = Math.min(total, a + per);
      if (a >= b) return null;
      // one browser per worker: background tabs in a shared browser don't paint, and their screenshots stall
      const own = await launch(), file = path.join(work, `seg${k}.mp4`), page = await openPage(own);
      const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation", "-pix_fmt", "yuv420p", "-g", String(FPS * 4),
        "-x264-params", "keyint=" + FPS * 4, "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", file], { stdio: ["pipe", "inherit", "inherit"] });
      const closed = new Promise((res, rej) => ff.on("close", (c) => (c ? rej(new Error("ffmpeg " + c)) : res())));
      for (let f = a; f < b; f++) {
        await page.evaluate((t) => draw(t), f / FPS);
        const buf = await shot(page);
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
        if (++done % 150 === 0) process.stdout.write(`  ${done}/${total} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
      }
      ff.stdin.end();
      await closed;
      await own.close();
      return file;
    };
    const files = (await Promise.all(Array.from({ length: N }, (_, k) => seg(k)))).filter(Boolean);
    const list = path.join(work, "segments.txt");
    fs.writeFileSync(list, files.map((f) => `file '${f}'\n`).join(""));
    await new Promise((res, rej) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", path.join(work, "video.mp4")], { stdio: "inherit" })
      .on("close", (c) => (c ? rej(new Error("concat " + c)) : res())));
    files.forEach((f) => fs.unlinkSync(f));
    console.log(`${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${path.join(work, "video.mp4")}`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
