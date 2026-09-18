"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { shoppingCount } from "@/lib/client";
import { Icon } from "./Icon";

export function CartLink() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const refresh = () => setN(shoppingCount());
    refresh();
    window.addEventListener("shopping-changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("shopping-changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return (
    <Link href="/shopping" className="icon-btn cart-link" title="قائمة التسوق" aria-label="قائمة التسوق">
      <Icon name="cart" />
      {n > 0 && <span className="cart-badge">{n}</span>}
    </Link>
  );
}
