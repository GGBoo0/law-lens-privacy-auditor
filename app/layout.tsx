import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host?.includes("localhost") ? "http" : "https");
  const origin = host ? new URL(`${protocol}://${host}`) : undefined;
  const title = "법령렌즈 — 개인정보처리방침 리스크 분석";
  const description =
    "웹사이트 개인정보처리방침을 추출하고 대한민국 개인정보 보호법 기준의 누락, 위반 소지, 그레이존을 근거 조문과 함께 분석합니다.";
  const socialImage = origin ? new URL("/og.png", origin).toString() : undefined;

  return {
    title,
    description,
    metadataBase: origin,
    icons: {
      icon: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ko_KR",
      images: socialImage
        ? [{ url: socialImage, width: 1680, height: 945, alt: "법령렌즈" }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: socialImage ? [socialImage] : undefined,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
