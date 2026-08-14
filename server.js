const express = require("express");
const { spawn } = require("child_process");
const path = require("path");

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
      ) && url.pathname.includes("/status/")
    );
  } catch {
    return false;
  }
}

app.post("/api/download", (req, res) => {
  const url = req.body?.url;

  if (!url || !validTwitterUrl(url)) {
    return res.status(400).json({
      error: "Please enter a valid public X/Twitter post URL."
    });
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="twitter-video.mp4"'
  );

  const args = [
    "--no-playlist",
    "--format",
    "best[ext=mp4]/best",
    "--output",
    "-",
    url
  ];

  const downloader = spawn("yt-dlp", args);

  downloader.stdout.pipe(res);

  let errorOutput = "";

  downloader.stderr.on("data", (data) => {
    errorOutput += data.toString();
  });

  downloader.on("error", (error) => {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "The video downloader could not start."
      });
    }
  });

  downloader.on("close", (code) => {
    if (code !== 0) {
      console.error("yt-dlp error:", errorOutput);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Could not download that video."
        });
      }
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
