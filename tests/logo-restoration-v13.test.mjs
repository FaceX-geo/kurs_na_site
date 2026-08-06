import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectUrl = new URL("../", import.meta.url);

const careerSectors = ["port", "safety", "students"];
const formats = ["png", "webp"];

test("restored slogan assets include desktop and mobile exports", async () => {
  const assetNames = [
    ...careerSectors.flatMap((sector) => formats.flatMap((format) => [
      `career-${sector}-smile-logo-v13.${format}`,
      `career-${sector}-smile-logo-mobile-v13.${format}`,
    ])),
    ...formats.flatMap((format) => [
      `support-general-smile-logo-v13.${format}`,
      `support-general-smile-logo-mobile-v13.${format}`,
    ]),
  ];

  const stats = await Promise.all(assetNames.map((name) => (
    stat(new URL(`assets/images/${name}`, projectUrl))
  )));

  assert.ok(stats.every(({ size }) => size > 0));
});

test("landing forces dedicated mobile crops for restored scenes", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("index.html", projectUrl), "utf8"),
    readFile(new URL("scripts/main.js", projectUrl), "utf8"),
    readFile(new URL("styles/client-revision-v12.css", projectUrl), "utf8"),
  ]);

  for (const sector of careerSectors) {
    assert.match(html, new RegExp(`career-${sector}-smile-logo-mobile-v13\\.webp`));
    assert.match(html, new RegExp(`career-${sector}-smile-logo-v13\\.webp`));
    assert.match(script, new RegExp(`career-${sector}-smile-logo-v13\\.webp`));
  }

  assert.match(html, /data-support-photo-source[^>]+media="\(max-width: 680px\)"[^>]+support-general-smile-logo-mobile-v13\.webp/);
  assert.match(html, /data-support-photo-fallback-source[^>]+support-general-smile-logo-mobile-v13\.png/);
  assert.match(html, /data-support-photo-desktop-source[^>]+support-general-smile-logo-v13\.webp/);
  assert.match(html, /data-support-photo[^>]+support-general-smile-logo-v13\.png/);
  assert.match(script, /mobilePhotoSource\.srcset = content\.media\.mobileSrc/);
  assert.match(script, /mobilePhotoFallbackSource/);
  assert.match(script, /desktopPhotoSource/);
  assert.match(css, /\.career-direction > \.career-direction__media/);
});
