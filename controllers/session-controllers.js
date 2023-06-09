const pool = require("./../db/db.js");
const queries = require("./../db/queries.js");
const axios = require("axios");
const {
  TMDB_API_KEY,
  CONFIGURATION,
  THRESHOLD_FOR_FILTERING,
  TOTAL_PAGES_DISCOVER,
  TOTAL_PAGES_TRENDING,
} = require("./../model/global-variables.js");
const Movie = require("./../model/movie.js");
const path = require("path");

const chooseMod = async (req, res) => {
  //Temporaneo, in attesa di sviluppo, placeholder per agevolare il debugging e sviluppo
  if (!req.session.user_id) {
    res.sendFile(path.resolve("./public/login.html"));
    return;
  }
  const { mod } = req.query;
  const user_id = Number(req.session.user_id);
  const session_id = await initializeSession(user_id, req, res);
  if (mod === "discovery") {
    res.redirect("/discovery");
  } else if (mod === "watchNow") {
    res.redirect("/watchnow");
  }
};

const initializeSession = async (user_id, req, res) => {
  const { session_id } = (await pool.query(queries.createSession, [user_id]))
    .rows[0];
  req.session.session_id = session_id;
  return session_id;
};

const addInteraction = async (req, res) => {
  const { preference, movie_id } = req.query;
  const session_id = Number(req.session.session_id);
  pool.query(queries.incViews, [session_id]);
  //Controlla se il film è presente nel database, altrimenti lo inserisce
  if (!(await checkMovie(movie_id))) {
    const movie = (await axios.get(`https://api.themoviedb.org/3/movie/${movie_id}?api_key=${TMDB_API_KEY}&language=en-US`)).data;
    await insertMovie(movie);
  }
  //Inserisce l'interazione nel database
  await pool.query(queries.createInteraction, [session_id, movie_id, preference]);
  //Incrementa il numero di like o inserisce nella tabella selected il film a seconda che sia stato selezionato o che sia stato messo like
  if (preference === "like") pool.query(queries.incLikes, [session_id]);
  else if (preference === "selected") {
    pool.query(queries.insertSelected, [session_id, movie_id]);
    res.send("Film selezionato");
    return;
  }
  //Conta il numero di inerazioni fatte dall'utente
  let num_interazioni = (
    await pool.query(queries.getInteractionsCount, [req.session.user_id])
  ).rows[0].count;

  let next = null;
  if (num_interazioni % 3 != 0)//Ogni 2 film filtrati, viene mostrato un film randomico
    next = await getMovieFunction(req.session.user_id);
  else next = await getRandomMovie();

  //Controlla che il film non sia già stato mostrato nella sessione corrente
  let duplicate = await checkFilm(next.id, session_id);

  let i = 0;
  while (duplicate) {
    i++;
    if (i > 50) break; //qui 50 indica il limite prima di considerare i film finiti
    if (i > 10) next = await getMovieFunction(req.session.user_id);
    else next = await getRandomMovie();
    duplicate = await checkFilm(next.id, session_id);
  }
  if (i <= 50) res.send(next);
  else res.send({ nonext: true }); //Non ci sono più film da mostrare
};

//Funzione che restituisce un film filtrato in json
const getFilteredMovieGenre = async (user_id) => {
  const magior2Genres = (await pool.query(queries.getMagior2Genres, [user_id]))
    .rows;
  let genresString = "";
  for (let i = 0; i < magior2Genres.length; i++) {
    genresString += magior2Genres[i].genre_id;
    if (i != magior2Genres.length - 1) genresString += ",";
  }

  const preResponse = await axios.get(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&include_adult=false&include_video=false&with_genres=${genresString}&vote_count.gte=100`
  );

  let total_pages = preResponse.data.total_pages;
  total_pages = total_pages > TOTAL_PAGES_DISCOVER ? TOTAL_PAGES_DISCOVER : total_pages;
  let page = Math.ceil(Math.random() * total_pages);

  const response = await axios.get(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&include_adult=false&include_video=false&page=${page}&with_genres=${genresString}&vote_count.gte=100`
  );

  const movies = response.data.results;
  const scelto = movies[Math.ceil(Math.random() * movies.length - 1)];
  return scelto;
};

//Funzione che restituisce un film randomico in json
//Verranno restituiti film che vengono considerati trand del momento, utilizzando le api nella sezione "Trending"
const getRandomMovie = async () => {
  const page = Math.ceil(Math.random() * 50);//Utilizziamo le prime 50 pagine di trending per evitare di mostrare film troppo vecchi o impopolari

  const response = await axios.get(
    `https://api.themoviedb.org/3/trending/movie/day?api_key=${TMDB_API_KEY}&page=${page}`
  );

  const movies = response.data.results;
  return movies[Math.ceil(Math.random() * movies.length - 1)];
};

const getMovieFunction = async (user_id) => {
  let num_piaciuti = (
    await pool.query(queries.countPositive, [Number(user_id)])
  ).rows[0].count;
  if (num_piaciuti > THRESHOLD_FOR_FILTERING)
    return getFilteredMovieGenre(user_id);
  else return getRandomMovie();
};

const checkFilm = async (movie_id, session_id) => {
  //Controlla se il film è già stato mostrato nella sessione
  const result = await pool.query(queries.checkFilm, [movie_id, session_id]);
  return result.rows.length;
};

const checkMovie = async (movie_id) => {
  //Controlla se il film è già presente nel database
  const result = await pool.query(queries.checkMovie, [movie_id]);
  return result.rows.length;
};

const insertMovie = async (movie) => {
  if (movie.poster_path == null) movie.poster_path = "Non disponibile";
  await pool.query(queries.insertMovie, [
    movie.id,
    movie.title,
    movie.overview,
    movie.runtime,
    movie.poster_path,
    movie.vote_average,
  ]);
  const genres = movie.genres;
  for (let i = 0; i < genres.length; i++) {
    pool.query(queries.insertMovieGenres, [movie.id, genres[i].id]);
  }
};

const insertMovieById = async (movie_id) => {
  const movie = (await axios.get(`https://api.themoviedb.org/3/movie/${movie_id}?api_key=${TMDB_API_KEY}&language=en-US`)).data;
  if (movie.poster_path == null) movie.poster_path = "Non disponibile";

  await pool.query(queries.insertMovie, [
    movie.id,
    movie.title,
    movie.overview,
    movie.runtime,
    movie.poster_path,
    movie.vote_average,
  ]);
  const genres = movie.genres;
  for (let i = 0; i < genres.length; i++) {
    pool.query(queries.insertMovieGenres, [movie.id, genres[i].id]);
  }
};

module.exports = {
  getMovieFunction,
  initializeSession,
  chooseMod,
  addInteraction,
  checkMovie,
  insertMovie,
  insertMovieById,
};
