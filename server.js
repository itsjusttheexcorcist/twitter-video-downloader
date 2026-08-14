const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

function validTwitterUrl(value) {
  try {
    const url = new URL(value);

    return (
      ["twitter.com", "www.twitter.com", "x.com", "www.x.com"].includes(
        url.hostname
      ) &&
      /\/status\/\d+/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

app.post("/api/download", async (req, res) => {
  const url = req.body?.url;

  if (!url || !validTwitterUrl(url)) {
    return res.status(400).json({
      error: "Please enter a valid public X/Twitter post URL."
    });
  }

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "twitter-video-")
  );

  const outputTemplate = path.join(tempDir, "video.%(ext)s");

  console.log("Downloading:", url);

  const args = [
    "--no-playlist",

    // Highest available video + highest available audio.
    // Fall back to the best combined format if separate streams
    // aren't available.
    "--format",
    "bv*+ba/b",

    // Put the final result into an MP4 container.
    "--merge-output-format",
    "mp4",

    // Remux to MP4 when necessary.
    "--remux-video",
    "mp4",

    "--output",
    outputTemplate,

    url
  ];

  const downloader = spawn("yt-dlp", args);

  let stderr = "";

  downloader.stderr.on("data", (data) => {
    const text = data.toString();
    stderr += text;
    console.log(text);
  });

  downloader.on("error", (error) => {
    console.error("Failed to start yt-dlp:", error);

    cleanup();

    if (!res.headersSent) {
      res.status(500).json({
        error: "The video downloader could not start."
      });
    }
  });

  downloader.on("close", (code) => {
    if (code !== 0) {
      console.error("yt-dlp exited with code:", code);
      console.error(stderr);

      cleanup();

      if (!res.headersSent) {
        res.status(500).json({
          error:
            "X/Twitter could not provide this video. Try another public post."
        });
      }

      return;
    }

    // Find the finished video.
    const files = fs.readdirSync(tempDir);

    const videoFile = files
      .filter((file) => /\.(mp4|m4v|mov|webm|mkv)$/i.test(file))
      .map((file) => path.join(tempDir, file))
      .find((file) => fs.statSync(file).size > 0);

    if (!videoFile) {
      console.error("yt-dlp completed but no video was produced.");
      cleanup();

      if (!res.headersSent) {
        res.status(500).json({
          error: "The video was found, but no downloadable file was produced."
        });
      }

      return;
    }

    const fileSize = fs.statSync(videoFile).size;

    console.log(
      `Download successful: ${(fileSize / 1024 / 1024).toFixed(2)} MB`
    );

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Length",
      fileSize
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="X-video.mp4"'
    );

    const stream = fs.createReadStream(videoFile);

    stream.pipe(res);

    stream.on("close", cleanup);

    stream.on("error", (error) => {
      console.error("File streaming error:", error);
      cleanup();
    });
  });

  function cleanup() {
    try {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true
      });
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
