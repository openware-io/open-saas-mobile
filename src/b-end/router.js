import { createRouter, createWebHashHistory } from 'vue-router'
import Reservations from './views/Reservations.vue'
import Orders from './views/Orders.vue'
import Stores from './views/Stores.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/reservations' },
    { path: '/reservations', name: 'reservations', component: Reservations },
    { path: '/orders', name: 'orders', component: Orders },
    { path: '/stores', name: 'stores', component: Stores },
  ],
})
export default router
