import { defineRouter } from "#q-app";
import { createRouter, createWebHashHistory } from "vue-router";
import routes from "./routes";

export default defineRouter(() =>
    createRouter({
        history: createWebHashHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
        routes
    })
);
