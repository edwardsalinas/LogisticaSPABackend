import express from 'express';
const router = express.Router();
// In a real app, we would import a controller/service that uses the supabase client
// import supabase from '../../config/supabase.js';

// Mock Data for POC
const MOCK_INVENTORY = [
    { id: 1, name: 'Laptops Dell Latitude', stock: 150, location: 'Bodega A', status: 'In Stock' },
    { id: 2, name: 'Monitores Samsung 24"', stock: 45, location: 'Bodega B', status: 'Low Stock' },
    { id: 3, name: 'Teclados Mecánicos', stock: 300, location: 'Bodega A', status: 'In Stock' },
    { id: 4, name: 'Sillas Ergonómicas', stock: 0, location: 'Bodega C', status: 'Out of Stock' },
    { id: 5, name: 'Mouse Inalámbricos', stock: 120, location: 'Bodega B', status: 'In Stock' }
];

// GET /api/logistics/inventory
router.get('/inventory', (req, res) => {
    // Simulate DB delay
    setTimeout(() => {
        res.json({
            success: true,
            data: MOCK_INVENTORY,
            source: 'Mock Data (Supabase Pending)'
        });
    }, 500);
});

// GET /api/logistics/stats
router.get('/stats', (req, res) => {
    const criticalStock = MOCK_INVENTORY.filter(i => i.stock < 50).length;
    res.json({
        totalItems: MOCK_INVENTORY.reduce((acc, curr) => acc + curr.stock, 0),
        criticalStockLines: criticalStock,
        activeWarehouses: 3
    });
});

export default router;
