export default function Dashboard() {
  return (
    <section className="panel">
      <h2>Dashboard</h2>
      <p>
        Base del CRM creada con usuarios, roles, permisos, cuentas,
        oportunidades, contactos, paises y monedas.
      </p>
      <div className="cards">
        <div className="card">
          <h3>Seguridad</h3>
          <p>RBAC con deny-by-default.</p>
        </div>
        <div className="card">
          <h3>Cuentas</h3>
          <p>Catalogos y propietarios multiples.</p>
        </div>
        <div className="card">
          <h3>Listo para crecer</h3>
          <p>Contactos y oportunidades luego.</p>
        </div>
      </div>
    </section>
  );
}