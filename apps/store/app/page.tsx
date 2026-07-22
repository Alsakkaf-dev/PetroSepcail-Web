import Link from "next/link";

export default function StoreHome() {
  return (
    <main dir="rtl" style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>بتروسبيشل — المتجر</h1>
      <p>زيوت ومنتجات تشحيم سعودية — تصفح الكتالوج الكامل أو ابحث عن منتج.</p>
      <p>
        <Link href="/catalog">تصفح المنتجات</Link> · <Link href="/search">بحث</Link>
      </p>
    </main>
  );
}
