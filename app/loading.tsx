export default function Loading() {
  return (
    <main id="main-content" aria-busy="true" aria-label="جاري تحميل الوصفات" className="container">
      <div className="topbar">
        <div className="brand">
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
          <div>
            <div className="skeleton" style={{ width: 150, height: 22 }} />
            <div className="skeleton" style={{ width: 70, height: 12, marginTop: 6 }} />
          </div>
        </div>
      </div>
      <div className="skeleton" style={{ height: 48, borderRadius: 999, marginBottom: 16 }} />
      <div className="grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card">
            <div className="skeleton" style={{ aspectRatio: "4 / 3" }} />
            <div className="card-body">
              <div className="skeleton" style={{ height: 16, width: "85%" }} />
              <div className="skeleton" style={{ height: 12, width: "50%", marginTop: 8 }} />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
