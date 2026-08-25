import type { Metadata } from "next";
import styles from "@/app/app-shell.module.scss";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.BASE_URL ?? "http://localhost:3005"),
  title: { default: "Ops", template: "%s · Ops" },
  description: "Production observability for registered services.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={styles.body}>{children}</body>
    </html>
  );
}
