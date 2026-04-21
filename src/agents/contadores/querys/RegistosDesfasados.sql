# consultar los registros de contadores que tienen fecha límite de reporte anterior al inicio del mes del último escaneo registrado, sugiriendo una nueva fecha límite basada en el último escaneo y la fecha límite actual
;WITH UltimoEscaneo AS (
    SELECT
        c.Serie,
        MAX(c.FechaCaptura) AS UltimoEscaneo
    FROM Contadores c
    WHERE c.Serie IS NOT NULL
      AND c.FechaCaptura >= DATEADD(MONTH, -2, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)) -- ultimos 2 meses
    GROUP BY c.Serie
)
SELECT
    cic.id,
    cic.Cliente,
    cic.Serie,
    cic.FechaLimiteReporte AS FechaLimiteActual,
    ue.UltimoEscaneo,
    DATEFROMPARTS(YEAR(ue.UltimoEscaneo), MONTH(ue.UltimoEscaneo), 1) AS InicioMesEscaneo,
    DATEADD(
        MONTH,
        DATEDIFF(
            MONTH,
            cic.FechaLimiteReporte,
            DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(ue.UltimoEscaneo), MONTH(ue.UltimoEscaneo), 1))
        ),
        cic.FechaLimiteReporte
    ) AS FechaLimiteSugerida
FROM ContadoresInfoClientes cic
INNER JOIN UltimoEscaneo ue ON ue.Serie = cic.Serie
WHERE cic.FechaLimiteReporte IS NOT NULL
  AND cic.FechaLimiteReporte < DATEFROMPARTS(YEAR(ue.UltimoEscaneo), MONTH(ue.UltimoEscaneo), 1)
ORDER BY ue.UltimoEscaneo DESC, cic.Cliente, cic.Serie;