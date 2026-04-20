BEGIN TRAN;

IF OBJECT_ID('tempdb..#Marcados') IS NOT NULL
    DROP TABLE #Marcados;

SELECT
    c.id,
    c.Serie,
    c.FechaCaptura,
    c.TotalImpresiones,
    ROW_NUMBER() OVER (
        PARTITION BY
            c.Serie,
            CAST(c.FechaCaptura AS date),
            c.TotalImpresiones
        ORDER BY c.id ASC   -- conserva el id menor
    ) AS rn
INTO #Marcados
FROM Contadores c
WHERE c.FechaCaptura >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
  AND c.FechaCaptura <  DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
  AND c.Serie IS NOT NULL
  AND c.TotalImpresiones IS NOT NULL;

-- Preview: estos se eliminarán
SELECT c.*
FROM Contadores c
INNER JOIN #Marcados m ON m.id = c.id
WHERE m.rn > 1
ORDER BY c.Serie, c.FechaCaptura, c.TotalImpresiones, c.id;

-- Delete real
DELETE c
FROM Contadores c
INNER JOIN #Marcados m ON m.id = c.id
WHERE m.rn > 1;

SELECT @@ROWCOUNT AS FilasEliminadas;

COMMIT TRAN;
-- Si quieres validar antes de borrar:
-- cambia COMMIT por ROLLBACK