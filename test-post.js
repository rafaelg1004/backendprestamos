(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/prestamos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cliente_id: "721a97db-2f88-4c1d-b6a1-a6b106292bf6", 
        monto_principal: 1000000,
        tasa_interes_mensual: 5,
        tasa_mora_diaria: 0.5,
        fecha_inicio: "2023-10-01",
        fecha_vencimiento: null,
        fondos: [{ inversion_id: "6e26b1c0-1b2c-4e8b-b1e0-e7f09f0df81e", monto: 1000000 }],
        salidas: [{ cuenta_id: "b212f862-520e-473d-82c5-7f511786c6b3", monto: 1000000 }],
        notas: ""
      })
    });
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Body:", text);
  } catch (e) {
    console.error(e);
  }
})();
