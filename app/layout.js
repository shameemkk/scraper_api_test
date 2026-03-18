import "./globals.css";

export const metadata = {
  title: "Email Scraper Dashboard",
  description: "Email scraper dashboard for monitoring and managing scraping operations",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
