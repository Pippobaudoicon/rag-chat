import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LDS RAG Chat",
    short_name: "LDS RAG",
    description:
      "AI assistant grounded in LDS scriptures, conference talks, handbook and Liahona",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#1a1a1a",
    theme_color: "#1a1a1a",
    categories: ["education", "utilities"],
    lang: "it",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/maskable-icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
