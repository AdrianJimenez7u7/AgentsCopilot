-- Impresoras con más de 1 escaneo en el mes actual
SELECT
    c.Serie,
    COUNT(*) AS TotalEscaneosMes,
    MIN(c.FechaCaptura) AS PrimerEscaneoMes,
    MAX(c.FechaCaptura) AS UltimoEscaneoMes
FROM Contadores c
WHERE c.FechaCaptura >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
  AND c.FechaCaptura <  DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
  AND c.Serie IS NOT NULL
GROUP BY c.Serie
HAVING COUNT(*) > 1
ORDER BY TotalEscaneosMes DESC, c.Serie;