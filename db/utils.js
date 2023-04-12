const Movie = require("../model/movie.js");
const axios = require("axios");
const pug = require("pug");
const express = require("express");
const { initialConfiguration } = require("../configure.js");
const pool = require("./db");
const queries = require("./queries");

const TMDB_API_KEY = "fcece093f96283eb8c3865c3be14e4d4";
const CONFIGURATION = initialConfiguration(TMDB_API_KEY);

const getMaxIdSessions = async function getMaxIdSessions() {
    const result = await pool.query(queries.getMaxIdSessions);
    return result.rows[0].max;
}

const createSession = (id_session, id_user) => {
    pool.query(queries.createSession, [id_session, id_user]);
}

const getMovie = async (username, id_session, res) => {
    try {
        const response = await axios.get(
            `https://api.themoviedb.org/3/movie/top_rated?api_key=${TMDB_API_KEY}`
        );
        const movies = response.data.results;
        const firstMovie = new Movie(
            movies[Math.ceil(Math.random() * movies.length - 1)]
        );
        CONFIGURATION.then((config) => {
            res.render("partials/movie_card.pug", {
                movie: firstMovie,
                config: config,
                username: username,
                id_session: id_session,
            });
        }).catch((err) => {
            console.log(err);
        });
    } catch (error) {
        console.error(error);
        res
            .status(500)
            .json({ message: "Errore durante la richiesta film randomico" });
    }
};

const initializeSession = async (user, res) => {
    const id_session = await getMaxIdSessions() + 1;
    createSession(id_session, user.id);
    //Inseriamo l'id della sessione nel cookie e altri dati di convenienza
    res.cookie("id_session", String(id_session));
    res.cookie("id_user", String(user.id));
    res.cookie("username", user.username);

    getMovie(user.username, id_session, res);
}


module.exports = {
    getMovie,
    getMaxIdSessions,
    initializeSession,
};