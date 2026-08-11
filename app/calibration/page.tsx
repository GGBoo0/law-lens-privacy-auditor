import type { Metadata } from "next";
import Link from "next/link";
import CalibrationWorkspace from "./CalibrationWorkspace";
import styles from "./calibration.module.css";

export const metadata: Metadata = {
  title: "개발자 사전 교정 | 법령렌즈",
  description:
    "법령렌즈 분석 결과의 맞음, 오탐, 판단 유보와 놓친 항목을 24개 표본으로 사전 점검하는 기기 전용 작업공간입니다.",
};

export default function CalibrationPage() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#calibration-workspace">
        사전 교정 작업공간으로 건너뛰기
      </a>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="법령렌즈 홈으로">
          <span className={styles.brandMark} aria-hidden="true">
            ㄹ
          </span>
          <span>법령렌즈</span>
        </Link>
        <nav className={styles.topnav} aria-label="서비스 안내">
          <Link href="/">분석</Link>
          <Link href="/methodology">평가 방법</Link>
          <Link href="/privacy">저장 안내</Link>
          <span aria-current="page">사전 교정</span>
        </nav>
      </header>

      <CalibrationWorkspace />
    </main>
  );
}
